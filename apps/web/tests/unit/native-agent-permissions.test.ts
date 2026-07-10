import { describe, expect, it, vi } from "vitest";

import {
  registerNativeAgentPermission,
  resolveNativeAgentPermission,
} from "@/lib/ai/native-agent/permissions";

describe("native agent permission ownership", () => {
  it("does not let another user resolve a pending permission request", () => {
    const resolve = vi.fn();
    registerNativeAgentPermission("request-owned-by-a", {
      ownerUserId: "user-a",
      providerToolUseId: "provider-tool-1",
      createdAt: Date.now(),
      resolve,
      reject: vi.fn(),
    });

    expect(
      resolveNativeAgentPermission({
        requestId: "request-owned-by-a",
        ownerUserId: "user-b",
        result: { behavior: "allow" },
      }),
    ).toBe("forbidden");
    expect(resolve).not.toHaveBeenCalled();

    expect(
      resolveNativeAgentPermission({
        requestId: "request-owned-by-a",
        ownerUserId: "user-a",
        result: { behavior: "deny" },
      }),
    ).toBe("resolved");
    expect(resolve).toHaveBeenCalledWith({ behavior: "deny" });
  });

  it("reports unknown and already-resolved request ids as not found", () => {
    expect(
      resolveNativeAgentPermission({
        requestId: "missing-request",
        ownerUserId: "user-a",
        result: { behavior: "deny" },
      }),
    ).toBe("not_found");
  });
});
