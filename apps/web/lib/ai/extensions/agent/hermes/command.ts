export interface HermesProviderConfig {
  hermesPath?: string;
  profile?: string;
  timeoutMs?: number;
}

export interface HermesAcpCommand {
  command: string;
  args: string[];
}

export function normalizeHermesProviderConfig(
  value: Record<string, unknown> | undefined,
): HermesProviderConfig {
  return {
    hermesPath:
      typeof value?.hermesPath === "string" && value.hermesPath.trim()
        ? value.hermesPath.trim()
        : undefined,
    profile:
      typeof value?.profile === "string" && value.profile.trim()
        ? value.profile.trim()
        : undefined,
    timeoutMs:
      typeof value?.timeoutMs === "number" &&
      Number.isInteger(value.timeoutMs) &&
      value.timeoutMs > 0
        ? value.timeoutMs
        : undefined,
  };
}

export function buildHermesAcpCommand(
  providerConfig?: Record<string, unknown>,
): HermesAcpCommand {
  const config = normalizeHermesProviderConfig(providerConfig);
  const args: string[] = [];

  if (config.profile) {
    args.push("--profile", config.profile);
  }

  args.push("acp");

  return {
    command: config.hermesPath || "hermes",
    args,
  };
}
