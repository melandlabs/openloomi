/**
 * Shared permission response store for native agent runs.
 *
 * The agent runner creates pending permission promises, while
 * /api/native/agent/permission resolves them after the user responds.
 */

export type NativeAgentPermissionResult = {
  behavior: "allow" | "deny";
  updatedInput?: Record<string, unknown>;
};

export const permissionResponses = new Map<
  string,
  {
    resolve: (result: NativeAgentPermissionResult) => void;
    reject: (error: Error) => void;
  }
>();
