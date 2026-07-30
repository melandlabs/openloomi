import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type OpenLoomiAuthTokenSource = "env" | "file" | "missing";

export interface OpenLoomiAuthToken {
  token: string | null;
  source: OpenLoomiAuthTokenSource;
  path?: string;
  error?: string;
}

export function getOpenLoomiTokenPath(): string {
  return (
    process.env.OPENLOOMI_TOKEN_PATH ??
    path.join(os.homedir(), ".openloomi", "token")
  );
}

function looksLikeJwt(token: string): boolean {
  return token.split(".").length >= 2;
}

export function decodeStoredOpenLoomiToken(rawToken: string): string {
  const trimmed = rawToken.trim();
  if (!trimmed || looksLikeJwt(trimmed)) {
    return trimmed;
  }

  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8").trim();
    return decoded || trimmed;
  } catch {
    return trimmed;
  }
}

export async function readOpenLoomiAuthToken(): Promise<OpenLoomiAuthToken> {
  const envToken = process.env.OPENLOOMI_AUTH_TOKEN?.trim();
  if (envToken) {
    return {
      token: decodeStoredOpenLoomiToken(envToken),
      source: "env",
    };
  }

  const tokenPath = getOpenLoomiTokenPath();
  try {
    const fileToken = await fs.readFile(tokenPath, "utf8");
    const token = decodeStoredOpenLoomiToken(fileToken);
    return {
      token: token || null,
      source: token ? "file" : "missing",
      path: tokenPath,
    };
  } catch (error) {
    return {
      token: null,
      source: "missing",
      path: tokenPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
