import type { Session } from "next-auth";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "node:crypto";
// Server-side Node native modules (static import, server-side security)
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
// Tauri-related imports (dynamic loading, avoid server-side window errors)
import { getDataDirectory } from "@/lib/tauri";
import { isTauriMode } from "@/lib/env";
import { getOrCreateShadowUser } from "@/lib/db/remote-user-queries";

// ========== Core environment detection (distinguish client/server/Tauri) ==========
/**
 * Precisely determine if it's a client environment (has window)
 */
const isClientEnv = (): boolean => {
  return (
    typeof window !== "undefined" && typeof window.document !== "undefined"
  );
};

/**
 * Determine if it's a Tauri client environment
 */
const isTauriClientEnv = (): boolean => {
  return isClientEnv() && process.env.IS_TAURI === "true";
};

/**
 * Check if it's a server environment
 */
const isServerEnv = (): boolean => {
  return !isClientEnv();
};

/**
 * Exposed Tauri environment check (for backward compatibility)
 */
export const isTauriProductionEnv = (): boolean => {
  // Don't enable file storage in non-Tauri environment
  if (!isTauriMode()) return false;
  // Server: return true (indicating file storage is needed)
  if (isServerEnv()) return true;
  // Client: original Tauri check logic
  return isTauriClientEnv();
};

// ========== Type Definitions ==========
export type SignInResult = {
  ok: boolean;
  status: number;
  error: string | null;
  url: string | null;
};

export interface AuthModuleLike {
  handlers: {
    GET: (request: Request) => Promise<Response>;
    POST: (request: Request) => Promise<Response>;
  };
  auth: () => Promise<Session | null>;
  signIn: (
    provider?: string,
    options?: Record<string, unknown>,
  ) => Promise<SignInResult>;
  signOut: (options?: Record<string, unknown>) => Promise<void>;
}

// ========== Core utility functions ==========
function generateShadowUserId(cloudUserId?: string, email?: string): string {
  // 1. Prefer cloudUserId (with prefix check)
  if (cloudUserId) {
    return cloudUserId.startsWith("cloud_")
      ? cloudUserId
      : `cloud_${cloudUserId}`;
  }

  // 2. Next, use email to generate (with prefix check)
  if (email) {
    const emailHash = createHash("sha256")
      .update(email.toLowerCase().trim())
      .digest("hex")
      .substring(0, 32);

    const fixedUuid = [
      emailHash.substring(0, 8),
      emailHash.substring(8, 12),
      emailHash.substring(12, 16),
      emailHash.substring(16, 20),
      emailHash.substring(20, 32),
    ].join("-");

    const emailBasedId = `cloud_${fixedUuid}`;
    return emailBasedId.startsWith("cloud_")
      ? emailBasedId
      : `cloud_${emailBasedId}`;
  }

  // 3. Fallback to UUID generation (with prefix check)
  const uuidBasedId = `cloud_${uuidv4()}`;
  return uuidBasedId.startsWith("cloud_")
    ? uuidBasedId
    : `cloud_${uuidBasedId}`;
}

// ========== Cross-environment file path retrieval (unified client/server path) ==========
/**
 * Get Session file path (automatically adapts to client/server)
 */
const getSessionFilePath = async (): Promise<string> => {
  // Client Tauri environment: use Tauri data directory
  if (isTauriClientEnv()) {
    const appDataDir = getDataDirectory();
    const sessionPath = `${appDataDir}/openloomi_session.json`;
    return sessionPath;
  }

  // Server Node environment: use system temp directory + app-specific directory (avoid permission issues)
  if (isServerEnv()) {
    const homeDir = os.homedir();
    const appDataDir = path.join(homeDir, ".openloomi");

    await fs.mkdir(appDataDir, { recursive: true });
    const sessionPath = path.join(appDataDir, "openloomi_session.json");
    return sessionPath;
  }

  // Non-Tauri client: use browser temporary storage (fallback)
  throw new Error("Unsupported environment for file storage");
};

// ========== Cross-environment file operation utilities (unified API, adapts to client/server) ==========
/**
 * Cross-environment file operation utility class (encapsulates client/server differences)
 */
const fileHandler = {
  /**
   * Check if file exists (adapts to client/server)
   */
  exists: async (filePath: string): Promise<boolean> => {
    // Client Tauri
    if (isTauriClientEnv()) {
      const { fileExists } = await import("@/lib/tauri");
      return await fileExists(filePath);
    }
    // Server Node
    if (isServerEnv()) {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  },

  /**
   * Create directory (adapts to client/server)
   */
  mkdir: async (dirPath: string): Promise<void> => {
    // Client Tauri
    if (isTauriClientEnv()) {
      const { mkdirCustom } = await import("@/lib/tauri");
      return mkdirCustom(dirPath);
    }
    // Server Node
    if (isServerEnv()) {
      await fs.mkdir(dirPath, { recursive: true });
      return;
    }
  },

  /**
   * Write text file (adapts to client/server)
   */
  writeTextFile: async (filePath: string, content: string): Promise<void> => {
    // Client Tauri
    if (isTauriClientEnv()) {
      const { writeTextFileCustom } = await import("@/lib/tauri");
      return writeTextFileCustom(filePath, content);
    }
    // Server Node
    if (isServerEnv()) {
      // Ensure directory exists
      const dirPath = path.dirname(filePath);
      await fs.mkdir(dirPath, { recursive: true });
      return fs.writeFile(filePath, content, "utf-8");
    }
    throw new Error("Unsupported environment for write file");
  },

  /**
   * Read text file (adapts to client/server)
   */
  readTextFile: async (filePath: string): Promise<string> => {
    // Client Tauri
    if (isTauriClientEnv()) {
      const { readTextFileCustom } = await import("@/lib/tauri");
      const content = await readTextFileCustom(filePath);
      if (content === null) {
        throw new Error("Failed to read file");
      }
      return content;
    }
    // Server Node
    if (isServerEnv()) {
      return fs.readFile(filePath, "utf-8");
    }
    throw new Error("Unsupported environment for read file");
  },

  /**
   * Delete file (adapts to client/server)
   */
  removeFile: async (filePath: string): Promise<void> => {
    // Client Tauri
    if (isTauriClientEnv()) {
      const { removeFileCustom } = await import("@/lib/tauri");
      return removeFileCustom(filePath);
    }
    // Server Node
    if (isServerEnv()) {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        console.warn(
          `[FileAuth] Failed to delete file: ${(error as Error).message}`,
        );
      }
    }
  },
};

// ========== Unified Session storage (shared by client/server) ==========
const authStorage = {
  /**
   * Store Session to file (automatically adapts to client/server)
   */
  setSession: async (session: Session): Promise<void> => {
    try {
      const sessionPath = await getSessionFilePath();

      // Ensure directory exists
      const dirPath = isTauriClientEnv()
        ? sessionPath.substring(0, sessionPath.lastIndexOf("/"))
        : path.dirname(sessionPath);
      await fileHandler.mkdir(dirPath);

      // Write to file
      await fileHandler.writeTextFile(
        sessionPath,
        JSON.stringify(session, null, 2),
      );
    } catch (error) {
      const errMsg = `Failed to store session: ${(error as Error).message}`;
      console.error("[FileAuth] setSession error:", errMsg);
      throw new Error(errMsg);
    }
  },

  /**
   * Read Session from file (automatically adapts to client/server)
   */
  getSession: async (): Promise<Session | null> => {
    try {
      const sessionPath = await getSessionFilePath();

      // Check if file exists
      const fileExists = await fileHandler.exists(sessionPath);
      if (!fileExists) {
        return null;
      }

      // Read and parse file
      const sessionStr = await fileHandler.readTextFile(sessionPath);
      const session = JSON.parse(sessionStr) as Session;

      // Check if Session has expired
      const now = new Date();
      const expires = new Date(session.expires);
      if (expires < now) {
        await fileHandler.removeFile(sessionPath);
        return null;
      }
      return session;
    } catch (error) {
      console.error("[FileAuth] getSession error:", (error as Error).message);
      return null;
    }
  },

  /**
   * Clear Session file (automatically adapts to client/server)
   */
  clearSession: async (): Promise<void> => {
    try {
      const sessionPath = await getSessionFilePath();
      const fileExists = await fileHandler.exists(sessionPath);

      if (fileExists) {
        await fileHandler.removeFile(sessionPath);
      }
    } catch (error) {
      console.error("[FileAuth] clearSession error:", (error as Error).message);
    }
  },
};

// ========== Tauri production environment Auth module (compatible with client/server) ==========
export function createTauriProductionAuthModule(): AuthModuleLike {
  return {
    handlers: {
      GET: async () => {
        try {
          const session = await authStorage.getSession();
          return Response.json({
            ...session,
            ok: !!session,
            message: session ? "Session found (file storage)" : "No session",
          });
        } catch (error) {
          return Response.json(
            {
              ok: false,
              session: null,
              message: (error as Error).message || "Failed to get session",
            },
            { status: 500 },
          );
        }
      },
      POST: async (req: Request) => {
        try {
          const body = await req.json();
          const { cloudUserId, email, provider } = body;
          const userId = generateShadowUserId(cloudUserId, email);

          // Create shadow user in database to ensure foreign key constraints work
          try {
            await getOrCreateShadowUser({
              id: userId,
              email,
              name: email?.split("@")[0] || "User",
              avatarUrl: `https://avatar.vercel.sh/${email || userId}`,
            });
          } catch (dbError) {
            // Log but don't fail the sign-in if shadow user creation fails
            console.error("[TauriAuth] Failed to create shadow user:", dbError);
          }

          const dynamicSession: Session = {
            user: {
              id: userId,
              email: email,
              name: email?.split("@")[0],
              displayName: email?.split("@")[0],
              // Note: For simplicity, we treat all Tauri users as "regular" type in this implementation.
              // In a real-world scenario, you might want to differentiate based on the provider or other criteria.
              type: provider || "regular",
              // Note: In production, we should ideally fetch the avatar URL from the cloud user profile if available.
              // For simplicity, we use a generated avatar here.
              avatarUrl: `https://avatar.vercel.sh/${email || userId}`,
            },
            expires: new Date(
              Date.now() + 365 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          };

          await authStorage.setSession(dynamicSession);
          return Response.json({ ok: true, session: dynamicSession });
        } catch (error) {
          return Response.json(
            { ok: false, error: (error as Error).message },
            { status: 500 },
          );
        }
      },
    },

    auth: async () => authStorage.getSession(),

    signIn: async (
      provider?: string,
      options?: Record<string, unknown>,
    ): Promise<SignInResult> => {
      try {
        const { cloudUserId, email, name } = options || {};
        const userId = generateShadowUserId(
          cloudUserId as string | undefined,
          email as string,
        );

        // Create shadow user in database to ensure foreign key constraints work
        try {
          await getOrCreateShadowUser({
            id: userId,
            email: email as string,
            name: (name as string) || (email as string)?.split("@")[0] || null,
            avatarUrl: `https://avatar.vercel.sh/${email || userId}`,
          });
        } catch (dbError) {
          // Log but don't fail the sign-in if shadow user creation fails
          console.error("[TauriAuth] Failed to create shadow user:", dbError);
        }

        const dynamicSession: Session = {
          user: {
            id: userId,
            email:
              (email as string) ||
              `smoke_user_${userId.substring(7, 12)}@test.com`,
            name:
              (name as string) ||
              (email as string)?.split("@")[0] ||
              "Smoke User",
            type: "regular",
            displayName:
              (name as string) ||
              (email as string)?.split("@")[0] ||
              "Smoke User",
            avatarUrl: `https://avatar.vercel.sh/${email || userId}`,
          },
          expires: new Date(
            Date.now() + 365 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        };

        await authStorage.setSession(dynamicSession);

        return {
          ok: true,
          status: 200,
          error: null,
          url: null,
        };
      } catch (error) {
        console.error("[FileAuth] SignIn error:", error);
        return {
          ok: false,
          status: 500,
          error: (error as Error).message || "Sign in failed",
          url: null,
        };
      }
    },

    signOut: async (_options?: Record<string, unknown>) => {
      await authStorage.clearSession();
    },
  } satisfies AuthModuleLike;
}
