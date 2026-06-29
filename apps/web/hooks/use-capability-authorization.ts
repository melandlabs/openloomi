"use client";

/**
 * useCapabilityAuthorization — the unified "guide the user to authorize" entry
 * point of the onboarding framework.
 *
 * It routes a {@link Capability} to whichever existing authorization subsystem
 * owns it, so callers (seed-question chips, guidance cards, future surfaces)
 * never branch on connector-vs-permission:
 *   - connector  → the in-app `ConnectorAuthorizationProvider` flow (OAuth /
 *                  token form / QR), unchanged.
 *   - permission → the macOS permission registry grant action via
 *                  `runGrantAction`.
 *
 * New capability kinds are handled by adding a branch here — the call sites do
 * not change.
 */

import { useCallback } from "react";
import { useConnectorAuthorizationOptional } from "@/components/integration/connector-authorization-context";
import type { Capability } from "@/lib/capabilities";
import { getPermissionById } from "@/lib/permissions/registry";
import { runGrantAction } from "@/lib/permissions/service";

export interface AuthorizeCapabilityOptions {
  /** Short user-facing rationale forwarded to the connector authorization UI. */
  reason?: string;
  /** Invoked once the capability is granted (connector authorized / permission allowed). */
  afterSuccess?: () => void;
}

export interface CapabilityAuthorization {
  authorize: (
    capability: Capability,
    options?: AuthorizeCapabilityOptions,
  ) => Promise<void>;
  /** Whether the connector authorization context is mounted (chat surfaces). */
  canAuthorizeConnectors: boolean;
}

export function useCapabilityAuthorization(): CapabilityAuthorization {
  const connectorAuth = useConnectorAuthorizationOptional();

  const authorize = useCallback(
    async (capability: Capability, options?: AuthorizeCapabilityOptions) => {
      if (capability.kind === "connector") {
        if (!connectorAuth) return;
        connectorAuth.openAuthorization({
          platform: capability.platform,
          reason: options?.reason,
          afterSuccess: options?.afterSuccess,
        });
        return;
      }

      const definition = getPermissionById(capability.permissionId);
      if (!definition) return;
      const granted = await runGrantAction(definition.grantAction);
      if (granted) options?.afterSuccess?.();
    },
    [connectorAuth],
  );

  return {
    authorize,
    canAuthorizeConnectors: connectorAuth !== null,
  };
}
