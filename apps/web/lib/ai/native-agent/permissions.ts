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

interface PendingNativeAgentPermission {
  ownerUserId: string;
  providerToolUseId: string;
  createdAt: number;
  resolve: (result: NativeAgentPermissionResult) => void;
  reject: (error: Error) => void;
}

const pendingPermissions = new Map<string, PendingNativeAgentPermission>();

export function registerNativeAgentPermission(
  requestId: string,
  permission: PendingNativeAgentPermission,
): void {
  if (pendingPermissions.has(requestId)) {
    throw new Error(`Duplicate native agent permission request: ${requestId}`);
  }
  pendingPermissions.set(requestId, permission);
}

export function resolveNativeAgentPermission(input: {
  requestId: string;
  ownerUserId: string;
  result: NativeAgentPermissionResult;
}): "resolved" | "not_found" | "forbidden" {
  const pending = pendingPermissions.get(input.requestId);
  if (!pending) {
    return "not_found";
  }
  if (pending.ownerUserId !== input.ownerUserId) {
    return "forbidden";
  }

  pendingPermissions.delete(input.requestId);
  pending.resolve(input.result);
  return "resolved";
}

export function expireNativeAgentPermission(input: {
  requestId: string;
  ownerUserId: string;
}): boolean {
  const pending = pendingPermissions.get(input.requestId);
  if (!pending || pending.ownerUserId !== input.ownerUserId) {
    return false;
  }

  pendingPermissions.delete(input.requestId);
  pending.resolve({ behavior: "deny" });
  return true;
}
