import { compare } from "bcrypt-ts";
import NextAuth, { type DefaultSession, type Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import {
  getUser,
  createUser,
  getUserTypeForService,
  getLatestSurveyByUserId,
  getUserById,
} from "@/lib/db/queries";
import { authConfig } from "./auth.config";
import { DUMMY_PASSWORD, authSessionVersion } from "@/lib/env/constants";
import type { DefaultJWT } from "next-auth/jwt";
import { isTauriProductionEnv, createTauriProductionAuthModule } from "./tauri";

export type SignInResult = {
  ok: boolean;
  status: number;
  error: null;
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

export type UserType = "guest" | "regular" | "basic" | "pro" | "team";

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
    slackToken?: string;
    discordToken?: string;
    sessionVersion?: string | number;
    industry?: string | null;
    role?: string | null;
    roles?: string[];
    otherRole?: string | null;
    companySize?: string | null;
    communicationTools?: string[];
    dailyMessages?: string | null;
    challenges?: string[];
    surveyUpdatedAt?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    /** Cloud auth Bearer token (set during Google OAuth for cloud auth mode) */
    cloudAuthToken?: string;
  }
}

declare module "next-auth" {
  interface Session extends DefaultSession {
    cloudAuthToken?: string;
    user: {
      id: string;
      type: UserType;
      slackToken?: string;
      discordToken?: string;
      industry?: string | null;
      role?: string | null;
      roles?: string[];
      otherRole?: string | null;
      companySize?: string | null;
      communicationTools?: string[];
      dailyMessages?: string | null;
      challenges?: string[];
      surveyUpdatedAt?: string | null;
      displayName?: string | null;
      avatarUrl?: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    id?: string;
    name?: string | null;
    image?: string | null;
    avatarUrl?: string | null;
    displayName?: string | null;
    email?: string | null;
    type: UserType;
  }
}

function createProductionAuthModule() {
  // Configure providers dynamically based on environment
  const allProviders = [
    Credentials({
      credentials: {},
      async authorize({ email, password }: any) {
        const users = await getUser(email);
        if (users.length === 0) {
          await compare(password, DUMMY_PASSWORD);
          return null;
        }

        const [user] = users;

        if (!user.password) {
          await compare(password, DUMMY_PASSWORD);
          return null;
        }

        // Check if it's a shadow user (remote authentication)
        // Shadow user's ID starts with "cloud_", password uses bcrypt hash
        const isShadowUser = user.id?.startsWith("cloud_");

        if (isShadowUser) {
          // Shadow user uses bcrypt verification (SEC-05: migrated from SHA-256 to bcrypt)
          const shadowPasswordMatch = await compare(password, user.password);

          if (!shadowPasswordMatch) {
            return null;
          }

          return { ...user, type: "regular" };
        }

        // Local user uses bcrypt verification
        const passwordsMatch = await compare(password, user.password);

        if (!passwordsMatch) {
          return null;
        }

        return { ...user, type: "regular" };
      },
    }),
    // OAuth providers (Google, Slack, Discord) are handled by custom routes
    // not via NextAuth providers to support Tauri mode with cloud backend
  ];

  return NextAuth({
    ...authConfig,
    trustHost: true,
    providers: allProviders,
    callbacks: {
      async jwt({ token, user, account, profile, trigger }) {
        if (user) {
          token.id = user.id as string;
          token.type = user.type;
          token.sessionVersion = authSessionVersion;
          const derivedName =
            (typeof user.name === "string" && user.name.trim().length > 0
              ? user.name.trim()
              : typeof user.email === "string"
                ? user.email.split("@")[0]
                : null) ?? null;
          const userMedia = user as {
            avatarUrl?: string | null;
            image?: string | null;
          };
          const rawAvatar = userMedia.avatarUrl ?? userMedia.image ?? null;
          token.displayName = derivedName;
          token.avatarUrl =
            rawAvatar && rawAvatar.length > 0
              ? rawAvatar
              : (token.avatarUrl ?? null);
          if (!token.avatarUrl && typeof user.email === "string") {
            token.avatarUrl = `https://avatar.vercel.sh/${user.email}`;
          }
        }
        if (account?.provider === "slack" && account.access_token) {
          token.slackToken = account.access_token;
          const slackEmail = profile?.email as string;
          const users = await getUser(slackEmail);
          if (users.length === 0) {
            await createUser(slackEmail, DUMMY_PASSWORD);
            const [existingUser] = await getUser(slackEmail);
            token.id = existingUser.id;
            token.type = "regular";
          } else {
            const [existingUser] = users;
            token.id = existingUser.id;
            token.type = "regular";
          }
        }
        if (account?.provider === "discord" && account.access_token) {
          token.discordToken = account.access_token;
          const discordProfile = profile as {
            email?: string;
            id?: string;
          } | null;
          const discordEmail =
            discordProfile?.email ??
            (discordProfile?.id
              ? `${discordProfile.id}@discord.openloomi`
              : null);

          if (!discordEmail) {
            throw new Error(
              "Discord authorization did not return an email address.",
            );
          }

          const users = await getUser(discordEmail);
          if (users.length === 0) {
            await createUser(discordEmail, DUMMY_PASSWORD);
            const [newUser] = await getUser(discordEmail);
            token.id = newUser.id;
            token.type = "regular";
          } else {
            const [existingUser] = users;
            token.id = existingUser.id;
            token.type = "regular";
          }
        }
        if (token.id) {
          try {
            const resolvedType = await getUserTypeForService(token.id);
            if (resolvedType === "regular" && token.type === "guest") {
              // Preserve guest type while still allowing upgrades to override it below.
              token.type = "guest";
            } else if (resolvedType && token.type !== resolvedType) {
              token.type = resolvedType;
            }
          } catch (error) {
            console.error(
              "[Auth] Failed to resolve user subscription type",
              error,
            );
          }
        }

        if (token.id && (user || trigger === "update")) {
          try {
            const latestUser = await getUserById(token.id);
            if (latestUser) {
              const derivedName =
                latestUser.name ??
                token.displayName ??
                latestUser.email?.split("@")[0] ??
                null;
              token.displayName = derivedName;
              const resolvedAvatar =
                latestUser.avatarUrl ??
                token.avatarUrl ??
                (latestUser.email
                  ? `https://avatar.vercel.sh/${latestUser.email}`
                  : null);
              token.avatarUrl = resolvedAvatar;
              token.sessionVersion = latestUser.sessionVersion ?? 1;
            }
            const latestSurvey = await getLatestSurveyByUserId(token.id);
            if (latestSurvey) {
              token.industry = latestSurvey.industry;
              token.role = latestSurvey.role;
              token.roles = latestSurvey.roles ?? [latestSurvey.role];
              token.otherRole = latestSurvey.otherRole ?? null;
              token.companySize = latestSurvey.size;
              token.communicationTools = latestSurvey.communicationTools;
              token.dailyMessages = latestSurvey.dailyMessages;
              token.challenges = latestSurvey.challenges;
              token.surveyUpdatedAt =
                latestSurvey.submittedAt?.toISOString() ?? null;
            } else {
              token.industry = null;
              token.role = null;
              token.roles = [];
              token.otherRole = null;
              token.companySize = null;
              token.communicationTools = undefined;
              token.dailyMessages = null;
              token.challenges = undefined;
              token.surveyUpdatedAt = null;
            }
          } catch (error) {
            console.error(
              "[Auth] Failed to resolve latest survey profile",
              error,
            );
          }
        }

        return token;
      },
      async session({ session, token }) {
        // Pass cloud auth token from JWT to session
        (
          session as typeof session & { cloudAuthToken?: string }
        ).cloudAuthToken = token.cloudAuthToken;
        if (session.user) {
          session.user.id = token.id;
          session.user.type = token.type;
          session.user.slackToken = token.slackToken;
          session.user.discordToken = token.discordToken;
          session.user.industry = token.industry ?? null;
          session.user.role = token.role ?? null;
          session.user.roles = token.roles ?? [];
          session.user.otherRole = token.otherRole ?? null;
          session.user.companySize = token.companySize ?? null;
          session.user.communicationTools = token.communicationTools;
          session.user.dailyMessages = token.dailyMessages ?? null;
          session.user.challenges = token.challenges;
          session.user.surveyUpdatedAt = token.surveyUpdatedAt ?? null;

          // Get latest avatar from database as fallback
          let latestAvatarUrl: string | null | undefined = undefined;
          if (token.id) {
            try {
              const latestUser = await getUserById(token.id);
              latestAvatarUrl = latestUser?.avatarUrl;
              // Version mismatch = password changed on another device, current JWT is invalid
              const dbVersion = latestUser?.sessionVersion ?? 1;
              if (
                typeof token.sessionVersion === "number" &&
                token.sessionVersion !== dbVersion
              ) {
                if (session.user) {
                  // @ts-expect-error - invalidate session by removing user id
                  session.user.id = undefined;
                }
                return session;
              }
            } catch {
              // ignore
            }
          }

          const tokenMedia = token as {
            picture?: string | null;
            avatarUrl?: string | null;
          };
          const avatar =
            (token.avatarUrl as string | null | undefined) ??
            tokenMedia.picture ??
            latestAvatarUrl ??
            session.user.image ??
            (session.user.email
              ? `https://avatar.vercel.sh/${session.user.email}`
              : null);
          const resolvedName =
            (token.displayName as string | null | undefined) ??
            session.user.name ??
            session.user.email ??
            null;
          session.user.name = resolvedName ?? undefined;
          session.user.displayName = resolvedName ?? null;
          session.user.avatarUrl = avatar ?? null;
          session.user.image = avatar ?? null;

          return session;
        }

        return session;
      },
    },
  });
}

function createAuthModule(): AuthModuleLike {
  if (isTauriProductionEnv()) {
    return createTauriProductionAuthModule() as unknown as AuthModuleLike;
  }

  return createProductionAuthModule() as unknown as AuthModuleLike;
}

const authModule = createAuthModule();

// NextAuth v5's auth function supports multiple signatures:
// - auth() -> Promise<Session | null>
// - auth(req => {...}) -> NextMiddleware
// We need to preserve this for middleware usage
export const {
  handlers: { GET, POST },
  signIn,
  signOut,
} = authModule;

// Export auth directly to preserve its proper NextAuth v5 type signature
export const auth = authModule.auth as any;
