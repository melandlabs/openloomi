import type { Session } from "next-auth";
import {
  NativeAgentRequestError,
  runNativeAgentRequest as runPackageNativeAgentRequest,
  type NativeAgentRequest,
  type NativeAgentRun,
  type NativeAgentRunnerContext as PackageNativeAgentRunnerContext,
  type NativeAgentSession,
} from "@openloomi/ai/agent/native-runner";
import type {
  AgentRuntimePermissionHandler,
  AgentRuntimePermissionRequest,
} from "@openloomi/ai/agent/runtime";

import { nativeAgentHost } from "./host";
import {
  expireNativeAgentPermission,
  registerNativeAgentPermission,
} from "./permissions";

export type { NativeAgentRequest, NativeAgentRun };
export { NativeAgentRequestError };

export type AuthenticatedNativeAgentSession = Session &
  NativeAgentSession & {
    platform?: string;
  };

export interface NativeAgentRunnerContext extends Omit<
  PackageNativeAgentRunnerContext,
  "session"
> {
  session: AuthenticatedNativeAgentSession;
}

/**
 * Web/API compatibility wrapper around the package-level native agent runner.
 *
 * New CLI and other non-HTTP entry points should call
 * @openloomi/ai/agent/native-runner directly with nativeAgentHost.
 */
export async function runNativeAgentRequest(
  body: NativeAgentRequest,
  context: NativeAgentRunnerContext,
): Promise<NativeAgentRun> {
  return runPackageNativeAgentRequest(
    body,
    {
      ...context,
      permissionHandler:
        context.permissionHandler ??
        createNativeAgentPermissionHandler(
          body.permissionMode,
          context.userId,
          context.abortController.signal,
        ),
      emitPermissionRequestEvents:
        context.emitPermissionRequestEvents ?? !context.permissionHandler,
    },
    nativeAgentHost,
  );
}

function createNativeAgentPermissionHandler(
  permissionMode: NativeAgentRequest["permissionMode"],
  ownerUserId: string,
  signal: AbortSignal,
): AgentRuntimePermissionHandler {
  return (request) => {
    if (permissionMode === "dontAsk") {
      console.log(
        "[AgentAPI] Permission request auto-denied because permissionMode is dontAsk:",
        request,
      );
      return Promise.resolve({ behavior: "deny" });
    }

    return waitForPermissionResponse(request, ownerUserId, signal);
  };
}

function waitForPermissionResponse(
  request: AgentRuntimePermissionRequest,
  ownerUserId: string,
  signal: AbortSignal,
): Promise<{
  behavior: "allow" | "deny";
  updatedInput?: Record<string, unknown>;
}> {
  // A TTL timer prevents the Map entry from leaking if the user never responds
  // because a tab closed or the agent crashed.
  const PERMISSION_TTL_MS = 5 * 60 * 1000;
  return new Promise((resolve) => {
    const abortHandler = () => {
      expireNativeAgentPermission({
        requestId: request.requestId,
        ownerUserId,
      });
    };
    const ttl = setTimeout(() => {
      if (
        expireNativeAgentPermission({
          requestId: request.requestId,
          ownerUserId,
        })
      ) {
        console.warn(
          `[AgentAPI] Permission request timed out, auto-denying: ${request.requestId}`,
        );
      }
    }, PERMISSION_TTL_MS);
    registerNativeAgentPermission(request.requestId, {
      ownerUserId,
      providerToolUseId: request.toolUseID,
      createdAt: Date.now(),
      resolve: (result) => {
        clearTimeout(ttl);
        signal.removeEventListener("abort", abortHandler);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(ttl);
        signal.removeEventListener("abort", abortHandler);
        console.error("[AgentAPI] Permission request rejected:", error);
        resolve({ behavior: "deny" });
      },
    });
    signal.addEventListener("abort", abortHandler, { once: true });
    if (signal.aborted) {
      abortHandler();
    }
  });
}
