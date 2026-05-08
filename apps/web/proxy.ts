import { NextResponse, type NextRequest } from "next/server";
import {
  authSessionVersion,
  nextAuthSessionCookies,
} from "@/lib/env/constants";
import { createTauriProductionAuthModule } from "./app/(auth)/tauri";

// Initialize auth module (reuses file storage logic)
const tauriAuthModule = createTauriProductionAuthModule();

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ========== Original filter logic (fully preserved) ==========
  if (pathname === "/api/stripe/webhook") return NextResponse.next();
  if (pathname === "/api/telegram/webhook") return NextResponse.next();
  if (pathname === "/api/discord/interactions") return NextResponse.next();
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();
  if (pathname.startsWith("/api/landing")) return NextResponse.next();
  if (pathname.startsWith("/api/remote-auth")) return NextResponse.next();
  if (pathname.startsWith("/api/remote-feedback")) return NextResponse.next();
  if (pathname.startsWith("/api/brave-search")) return NextResponse.next();
  if (pathname.startsWith("/api/password-reset")) return NextResponse.next();
  if (pathname.startsWith("/api/ai")) return NextResponse.next();
  if (pathname.startsWith("/api/integrations")) return NextResponse.next();
  if (pathname.startsWith("/api/user") || pathname.startsWith("/api/quota"))
    return NextResponse.next();
  if (pathname.startsWith("/api/slack") || pathname.startsWith("/api/discord"))
    return NextResponse.next();
  if (pathname.startsWith("/api/stripe")) return NextResponse.next();
  if (pathname.startsWith("/api/billing")) return NextResponse.next();
  if (pathname.startsWith("/api/subscription")) return NextResponse.next();
  if (pathname.startsWith("/api/admin")) return NextResponse.next();
  if (
    pathname.startsWith("/api/slack/callback") ||
    pathname.startsWith("/api/discord/callback") ||
    pathname.startsWith("/api/google-drive/callback") ||
    pathname.startsWith("/api/x/callback")
  )
    return NextResponse.next();
  if (pathname.startsWith("/ping"))
    return new Response("pong", { status: 200 });
  if (pathname.startsWith("/api/auth")) return NextResponse.next();
  // /api/x is handled by its own Bearer token auth in the route handler
  if (pathname === "/api/x") return NextResponse.next();

  // ========== Special handling for /login path ==========
  // Allow /login through without permission check
  if (pathname === "/login") {
    // Clear all session cookies (prevent redirect after logout)
    const response = NextResponse.next();
    for (const cookieName of nextAuthSessionCookies) {
      response.cookies.set({
        name: cookieName,
        value: "",
        maxAge: 0,
        expires: new Date(0),
        path: "/",
      });
    }
    return response;
  }

  // ========== Core: mock auth mode allows through directly (priority) ==========
  const isMockAuth = process.env.NEXT_PUBLIC_MOCK_AUTH === "true";
  if (isMockAuth) {
    return NextResponse.next();
  }

  // ========== Core: read Session from file (replaces getToken) ==========
  let token = null;
  try {
    // 1. Tauri environment: read session from file (reuse existing utility)
    // Use file storage as long as IS_TAURI=true, no NODE_ENV restriction
    const isTauriEnv = process.env.IS_TAURI === "true";

    if (isTauriEnv) {
      const session = await tauriAuthModule.auth();
      if (session) {
        // Convert to original token structure (compatible with permission check logic)
        token = {
          type: session.user.type,
          sessionVersion: authSessionVersion, // Match the version constant
          userId: session.user.id,
          email: session.user.email,
        };
      }
    }
    // 2. Non-Tauri environment: keep original getToken logic (for debugging)
    else {
      const { getToken } = await import("next-auth/jwt");
      token = await getToken({
        req: request,
        secret: process.env.AUTH_SECRET,
        secureCookie: request.url.startsWith("https://"),
      });
    }
  } catch (error) {
    token = null;
  }

  // ========== Original permission logic (compatible with file-read token) ==========
  const publicPaths = new Set([
    "/",
    "/login",
    "/guest-login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/terms",
    "/privacy",
    "/landing",
    "/support",
    "/tos",
    "/api/landing",
    "/slack-authorized",
    "/discord-authorized",
    "/x-authorized",
    "/teams-authorized",
    "/hubspot-authorized",
    "/linear-authorized",
    "/jira-authorized",
  ]);
  const isStaticAsset = /\.[^/]+$/.test(pathname);
  const redirectWhenAuthenticatedPaths = new Set([
    "/register",
    "/forgot-password",
    "/reset-password",
    "/guest-login",
  ]);
  // /login special handling: only redirect to home page when user actively visits
  // If it's a redirect after logout (has callbackUrl), allow access to login page
  const isLoginPath = pathname === "/login";
  const hasCallbackUrl = request.nextUrl.searchParams.has("callbackUrl");

  const isPublicPath = publicPaths.has(pathname);
  const shouldRedirectWhenAuthenticated =
    redirectWhenAuthenticatedPaths.has(pathname) ||
    (isLoginPath && !hasCallbackUrl);

  const buildLoginRedirect = () => {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/guest-login";
    if (!loginUrl.searchParams.has("callbackUrl")) {
      const callbackTarget = `${pathname}${request.nextUrl.search}`.trim();
      loginUrl.searchParams.set(
        "callbackUrl",
        callbackTarget === "" ? "/" : callbackTarget,
      );
    }

    const response = NextResponse.redirect(loginUrl);
    for (const cookieName of nextAuthSessionCookies) {
      response.cookies.set({
        name: cookieName,
        value: "",
        maxAge: 0,
        expires: new Date(0),
        path: "/",
      });
    }
    return response;
  };

  // Permission check: use file-read token
  if (!token) {
    if (isPublicPath || isStaticAsset) {
      return NextResponse.next();
    }
    return buildLoginRedirect();
  }

  const isGuest = token.type === "guest";
  const hasValidSessionVersion = token.sessionVersion === authSessionVersion;

  // Allow guests to access "/" - they need a landing page after login
  // Guests are still redirected from other non-public paths
  const isRootPath = pathname === "/";
  if (!isPublicPath && (!hasValidSessionVersion || (isGuest && !isRootPath))) {
    return buildLoginRedirect();
  }

  if (!isGuest && shouldRedirectWhenAuthenticated) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",
    "/register",
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
