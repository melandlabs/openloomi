import { createHash } from "node:crypto";

import { canonicalJson } from "@openloomi/ai/agent/runtime-instructions";

/**
 * Creates the stable identity used to distinguish an idempotent retry from an
 * accidental reuse of the same idempotency key for a different command.
 */
export function createGoalCommandFingerprint(command: unknown): string {
  return createHash("sha256").update(canonicalJson(command)).digest("hex");
}
