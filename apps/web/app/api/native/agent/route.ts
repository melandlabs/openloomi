/**
 * Native Agent API Routes
 *
 * Provides API endpoints for agent execution over HTTP/SSE.
 */

import type { NextRequest } from "next/server";
import type { Session } from "next-auth";
import type { AgentMessage } from "@openloomi/ai/agent/types";

import { auth } from "@/app/(auth)/auth";
import { getAuthUser, type AuthUser } from "@/lib/auth/dual-auth";
import {
  NativeAgentRequestError,
  runNativeAgentRequest,
  type AuthenticatedNativeAgentSession,
  type NativeAgentRequest,
} from "@/lib/ai/native-agent/runner";

// Set max duration for long-running agent tasks.
// This prevents "TypeError: Load failed" when tool calls take a long time.
// NOTE: Vercel has hard limits (Hobby: 10s, Pro: 800s).
export const maxDuration = 800;

// Helper to create SSE stream with heartbeat to keep connection alive.
// SSE heartbeat sends a comment every 30 seconds to prevent idle timeouts
// from proxies, load balancers, and browsers.
function createSSEStream(
  generator: AsyncGenerator<AgentMessage>,
  onClose?: () => void,
) {
  const encoder = new TextEncoder();
  const HEARTBEAT_INTERVAL_MS = 30000;

  return new ReadableStream({
    async start(controller) {
      let heartbeatTimer: NodeJS.Timeout | undefined;

      const clearHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = undefined;
        }
      };

      const setupHeartbeat = () => {
        heartbeatTimer = setInterval(() => {
          try {
            // SSE comments are ignored by clients but keep the connection hot.
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          } catch {
            clearHeartbeat();
          }
        }, HEARTBEAT_INTERVAL_MS);
      };

      try {
        setupHeartbeat();

        for await (const message of generator) {
          const data = `data: ${JSON.stringify(message)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
      } catch (error) {
        console.error("[AgentAPI] Generator error:", {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          name: error instanceof Error ? error.name : String(error),
        });
        const errorData = `data: ${JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        })}\n\n`;
        try {
          controller.enqueue(encoder.encode(errorData));
        } catch {}
      } finally {
        clearHeartbeat();
        try {
          controller.close();
        } catch {}
        onClose?.();
        console.log("[AgentAPI] ===== CHAT COMPLETE =====");
      }
    },
  });
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

// Bearer-token callers, such as the one-shot CLI, do not have a full NextAuth
// session object. Business tools still expect session.user.id/type, so provide
// the smallest compatible shape here.
function createSessionFromAuthUser(
  authUser: AuthUser,
): AuthenticatedNativeAgentSession {
  return {
    user: {
      id: authUser.id,
      email: authUser.email ?? undefined,
      name: authUser.name ?? undefined,
      type: (authUser.type ?? "regular") as Session["user"]["type"],
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  } as AuthenticatedNativeAgentSession;
}

// POST /api/native/agent - Run agent.
export async function POST(req: NextRequest) {
  const abortController = new AbortController();

  try {
    const rawBodyText = await req.text();
    let body: NativeAgentRequest;
    try {
      body = JSON.parse(rawBodyText) as NativeAgentRequest;
    } catch (parseError) {
      console.error(
        "[AgentAPI] ERROR: Failed to parse request body:",
        parseError,
        rawBodyText,
      );
      return Response.json(
        { error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    // Authenticate with Bearer token first, then fall back to session cookies.
    const authUser = await getAuthUser(req);
    if (!authUser?.id) {
      console.error("[AgentAPI] ERROR: Unauthorized access attempt");
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Preserve the full NextAuth session for web requests; Bearer-token
    // requests get a minimal compatible session for business tools.
    const webSession = await auth();
    const session: AuthenticatedNativeAgentSession =
      webSession?.user?.id === authUser.id
        ? (webSession as AuthenticatedNativeAgentSession)
        : createSessionFromAuthUser(authUser);
    const requestPlatform = body.platform?.trim();
    if (requestPlatform) {
      // Let CLI and other scripted callers identify their source to downstream
      // business tools without changing the web session contract.
      session.platform = requestPlatform;
    }

    const run = await runNativeAgentRequest(body, {
      session,
      userId: authUser.id,
      abortController,
    });

    const readable = createSSEStream(run.generator, () => {
      if (run.shouldAbortOnClose()) {
        abortController.abort();
      }
    });

    return new Response(readable, { headers: SSE_HEADERS });
  } catch (error) {
    console.error("[AgentAPI] Error:", error);

    if (error instanceof NativeAgentRequestError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
