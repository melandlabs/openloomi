/**
 * Capability framework — openloomi stub.
 *
 * The openloomi reference defines a rich capability system describing what
 * agents are allowed to do (connectors + native permissions). openloomi's
 * Chronicle feature only needs the permission-registry-based authorization
 * flow plus a minimal connector shape so `use-capability-authorization`
 * type-checks.
 *
 * The exported `Capability` union mirrors the openloomi reference so consumers
 * can branch on `kind` ("connector" | "permission"). Anything that depends
 * on the full catalog (requirements, history, …) is intentionally omitted
 * until openloomi needs it.
 */

export type IntegrationId = string;

export type Capability =
  | { kind: "connector"; platform: IntegrationId }
  | { kind: "permission"; permissionId: string };

export type CapabilityKey = `connector:${string}` | `permission:${string}`;

export function capabilityKey(cap: Capability): CapabilityKey {
  return cap.kind === "connector"
    ? `connector:${cap.platform}`
    : `permission:${cap.permissionId}`;
}

export function capabilityFromKey(key: string): Capability | null {
  if (key.startsWith("connector:")) {
    return {
      kind: "connector",
      platform: key.slice("connector:".length) as IntegrationId,
    };
  }
  if (key.startsWith("permission:")) {
    return {
      kind: "permission",
      permissionId: key.slice("permission:".length),
    };
  }
  return null;
}

export function connectorCapability(platform: IntegrationId): Capability {
  return { kind: "connector", platform };
}

export function permissionCapability(permissionId: string): Capability {
  return { kind: "permission", permissionId };
}

export const CAPABILITY_REGISTRY: Capability[] = [];
