import type { AgentMessage } from "@openloomi/ai/agent/types";

export interface CodexTransportStatus {
  phase: "reconnecting" | "fallback";
  attempt?: number;
  maxAttempts?: number;
}

interface CodexTransportStatusPresenter {
  show: (status: CodexTransportStatus) => void;
  clear: () => void;
}

export interface CodexTransportStatusController {
  /**
   * Applies transport status side effects for one agent message.
   *
   * Returns true only when the message is a Codex transport retry that the
   * controller displayed. Terminal messages are still available to their
   * normal chat handlers after clearing the temporary status.
   */
  handle: (message: AgentMessage) => boolean;
  clear: () => void;
}

/**
 * Keeps transport recovery UI scoped to one agent turn. Repeated reconnect
 * events update one presentation, while every terminal path clears it.
 */
export function createCodexTransportStatusController(
  presenter: CodexTransportStatusPresenter,
): CodexTransportStatusController {
  let isVisible = false;

  const clear = () => {
    if (!isVisible) return;
    isVisible = false;
    presenter.clear();
  };

  return {
    handle(message) {
      if (
        message.type === "retry" &&
        (message.retryKind === "reconnecting" ||
          message.retryKind === "fallback")
      ) {
        const hasAttempt =
          typeof message.attempt === "number" &&
          typeof message.maxAttempts === "number";
        presenter.show({
          phase: message.retryKind,
          attempt: hasAttempt ? message.attempt : undefined,
          maxAttempts: hasAttempt ? message.maxAttempts : undefined,
        });
        isVisible = true;
        return true;
      }

      if (
        message.type === "result" ||
        message.type === "error" ||
        message.type === "done"
      ) {
        clear();
      }

      return false;
    },
    clear,
  };
}
