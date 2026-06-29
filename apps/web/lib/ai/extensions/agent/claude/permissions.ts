import type {
  CanUseTool,
  Options,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentOptions } from "@openloomi/ai/agent/types";

import type { ClaudeRuntimeLogger } from "./skills";

function toPermissionInputRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

/**
 * Bridge OpenLoomi's permission request callback into the Claude SDK
 * canUseTool hook.
 */
export function createCanUseToolOption({
  sessionId,
  options,
  logger,
  mode,
}: {
  sessionId: string;
  options?: Pick<AgentOptions, "permissionMode" | "onPermissionRequest">;
  logger: ClaudeRuntimeLogger;
  mode: "run" | "execute";
}): Partial<Pick<Options, "canUseTool">> {
  // If permissions are bypassed or no UI/API handler is available, do not
  // register a hook. Claude SDK will follow the selected permissionMode.
  if (
    !options?.permissionMode ||
    options.permissionMode === "bypassPermissions" ||
    !options.onPermissionRequest
  ) {
    return {};
  }

  const executeLabel = mode === "execute" ? " (execute)" : "";
  const canUseTool: CanUseTool = async (
    toolName,
    toolInput,
    canUseToolOptions,
  ): Promise<PermissionResult> => {
    // Keep the raw request in logs for debugging denied or transformed tool
    // inputs, but return only the SDK-shaped decision below.
    logger.info(
      `[Claude ${sessionId}] Permission request${executeLabel}: ${toolName}`,
      { toolInput, decisionReason: canUseToolOptions.decisionReason },
    );

    try {
      const result = await options.onPermissionRequest?.({
        toolName,
        toolInput,
        toolUseID: canUseToolOptions.toolUseID,
        decisionReason: canUseToolOptions.decisionReason,
        blockedPath: canUseToolOptions.blockedPath,
        title: canUseToolOptions.title,
        displayName: canUseToolOptions.displayName,
        description: canUseToolOptions.description,
        agentID: canUseToolOptions.agentID,
      });

      if (!result) {
        logger.warn(
          `[Claude ${sessionId}] No permission handler${executeLabel}, denying ${toolName}`,
        );
        return {
          behavior: "deny",
          message: "Permission check not available",
          toolUseID: canUseToolOptions.toolUseID,
        };
      }

      // OpenLoomi's callback result is close to the SDK shape, but the SDK also
      // needs the original toolUseID echoed back for correlation.
      logger.info(
        `[Claude ${sessionId}] Permission decision${executeLabel}: ${result.behavior}`,
      );

      if (result.behavior === "allow") {
        return {
          behavior: "allow",
          // Current Claude SDK runtime validation expects allow decisions to
          // carry a record-shaped updatedInput. If OpenLoomi did not transform
          // the input, echo the original tool input back unchanged.
          updatedInput: toPermissionInputRecord(
            result.updatedInput ?? toolInput,
          ),
          toolUseID: canUseToolOptions.toolUseID,
        };
      }

      return {
        behavior: "deny",
        message: result.message || "Permission denied by user",
        toolUseID: canUseToolOptions.toolUseID,
      };
    } catch (error) {
      // Fail closed: a broken permission UI/handler should not silently allow a
      // potentially destructive tool call.
      logger.error(
        `[Claude ${sessionId}] Permission request error${executeLabel}:`,
        error,
      );
      return {
        behavior: "deny",
        message:
          error instanceof Error ? error.message : "Permission check failed",
        toolUseID: canUseToolOptions.toolUseID,
      };
    }
  };

  return { canUseTool };
}
