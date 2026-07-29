import type {
  RuntimeInstructionTransportPort,
  RuntimeSessionLifecycleControlPort,
  RuntimeSessionResolverPort,
} from "@openloomi/ai/agent/runtime-instructions";

interface RegisteredRuntimeSession {
  ownerId: string;
  transport: RuntimeInstructionTransportPort;
  registrations: Set<symbol>;
}

export interface RuntimeSessionRegistration {
  readonly ownerId: string;
  readonly runtimeSessionId: string;
  release(): void;
}

export type RuntimeSessionRegistryErrorCode =
  | "invalid_registration"
  | "lifecycle_unsupported"
  | "owner_conflict"
  | "transport_conflict";

export class RuntimeSessionRegistryError extends Error {
  constructor(
    public readonly code: RuntimeSessionRegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeSessionRegistryError";
  }
}

/**
 * Owner-scoped registry of live runtime transports.
 *
 * Registration handles carry a unique token. Releasing a stale handle cannot
 * remove a newer session registration (the common close/reconnect ABA race).
 */
export class RuntimeSessionRegistry implements RuntimeSessionResolverPort {
  private readonly sessions = new Map<string, RegisteredRuntimeSession>();

  register(input: {
    ownerId: string;
    transport: RuntimeInstructionTransportPort;
  }): RuntimeSessionRegistration {
    const ownerId = requiredIdentifier(input.ownerId, "ownerId");
    const runtimeSessionId = requiredIdentifier(
      input.transport.runtimeSessionId,
      "runtimeSessionId",
    );
    const existing = this.sessions.get(runtimeSessionId);

    if (existing && existing.ownerId !== ownerId) {
      throw new RuntimeSessionRegistryError(
        "owner_conflict",
        `Runtime Session ${runtimeSessionId} is already registered to another owner`,
      );
    }
    if (existing && existing.transport !== input.transport) {
      throw new RuntimeSessionRegistryError(
        "transport_conflict",
        `Runtime Session ${runtimeSessionId} already has a live transport`,
      );
    }

    const registrationToken = Symbol(runtimeSessionId);
    const registered =
      existing ??
      ({
        ownerId,
        transport: input.transport,
        registrations: new Set<symbol>(),
      } satisfies RegisteredRuntimeSession);
    registered.registrations.add(registrationToken);
    this.sessions.set(runtimeSessionId, registered);

    let released = false;
    return {
      ownerId,
      runtimeSessionId,
      release: () => {
        if (released) return;
        released = true;

        const active = this.sessions.get(runtimeSessionId);
        if (
          !active ||
          active.ownerId !== ownerId ||
          active.transport !== input.transport
        ) {
          return;
        }
        active.registrations.delete(registrationToken);
        if (active.registrations.size === 0) {
          this.sessions.delete(runtimeSessionId);
        }
      },
    };
  }

  async resolve(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<RuntimeInstructionTransportPort | null> {
    const session = this.sessions.get(runtimeSessionId);
    return session?.ownerId === ownerId ? session.transport : null;
  }

  async resolveLifecycle(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<RuntimeSessionLifecycleControlPort | null> {
    const transport = await this.resolve(ownerId, runtimeSessionId);
    if (!transport) return null;
    if (!isLifecycleControl(transport)) {
      throw new RuntimeSessionRegistryError(
        "lifecycle_unsupported",
        `Runtime Session ${runtimeSessionId} does not support Goal replacement lifecycle control`,
      );
    }
    return transport;
  }

  isCurrent(
    ownerId: string,
    transport: RuntimeInstructionTransportPort,
  ): boolean {
    const session = this.sessions.get(transport.runtimeSessionId);
    return session?.ownerId === ownerId && session.transport === transport;
  }

  get size(): number {
    return this.sessions.size;
  }
}

function isLifecycleControl(
  transport: RuntimeInstructionTransportPort,
): transport is RuntimeSessionLifecycleControlPort {
  const candidate = transport as Partial<RuntimeSessionLifecycleControlPort>;
  return (
    typeof candidate.runEpoch === "number" &&
    typeof candidate.captureTurnBoundary === "function" &&
    typeof candidate.captureTurnBoundaryAndHoldPendingInput === "function" &&
    typeof candidate.waitForTurnTerminal === "function" &&
    typeof candidate.advanceRunEpoch === "function"
  );
}

const MAX_RUNTIME_IDENTIFIER_CHARACTERS = 256;

function requiredIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new RuntimeSessionRegistryError(
      "invalid_registration",
      `${field} must be a string`,
    );
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new RuntimeSessionRegistryError(
      "invalid_registration",
      `${field} must not be empty`,
    );
  }
  if (normalized !== value) {
    throw new RuntimeSessionRegistryError(
      "invalid_registration",
      `${field} must not contain surrounding whitespace`,
    );
  }
  if (value.length > MAX_RUNTIME_IDENTIFIER_CHARACTERS) {
    throw new RuntimeSessionRegistryError(
      "invalid_registration",
      `${field} must not exceed ${MAX_RUNTIME_IDENTIFIER_CHARACTERS} characters`,
    );
  }
  return value;
}
