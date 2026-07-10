export interface OpenClawProviderConfig {
  openclawPath?: string;
  gatewayUrl?: string;
  tokenFile?: string;
  passwordFile?: string;
  session?: string;
  sessionLabel?: string;
  requireExisting?: boolean;
  resetSession?: boolean;
  noPrefixCwd?: boolean;
  provenance?: "off" | "meta" | "meta+receipt";
  timeoutMs?: number;
}

export interface OpenClawAcpCommand {
  command: string;
  args: string[];
}

export function normalizeOpenClawProviderConfig(
  value: Record<string, unknown> | undefined,
): OpenClawProviderConfig {
  const provenance = readString(value?.provenance);

  return {
    openclawPath: readString(value?.openclawPath),
    gatewayUrl: readString(value?.gatewayUrl),
    tokenFile: readString(value?.tokenFile),
    passwordFile: readString(value?.passwordFile),
    session: readString(value?.session),
    sessionLabel: readString(value?.sessionLabel),
    requireExisting: value?.requireExisting === true,
    resetSession: value?.resetSession === true,
    noPrefixCwd: value?.noPrefixCwd === true,
    provenance:
      provenance === "off" ||
      provenance === "meta" ||
      provenance === "meta+receipt"
        ? provenance
        : undefined,
    timeoutMs:
      typeof value?.timeoutMs === "number" &&
      Number.isInteger(value.timeoutMs) &&
      value.timeoutMs > 0
        ? value.timeoutMs
        : undefined,
  };
}

export function buildOpenClawAcpCommand(
  providerConfig?: Record<string, unknown>,
): OpenClawAcpCommand {
  const config = normalizeOpenClawProviderConfig(providerConfig);
  const args = ["acp"];

  pushOption(args, "--url", config.gatewayUrl);
  pushOption(args, "--token-file", config.tokenFile);
  pushOption(args, "--password-file", config.passwordFile);
  pushOption(args, "--session", config.session);
  pushOption(args, "--session-label", config.sessionLabel);
  if (config.requireExisting) args.push("--require-existing");
  if (config.resetSession) args.push("--reset-session");
  if (config.noPrefixCwd) args.push("--no-prefix-cwd");
  pushOption(args, "--provenance", config.provenance);

  return {
    command: config.openclawPath || "openclaw",
    args,
  };
}

function pushOption(
  args: string[],
  name: string,
  value: string | undefined,
): void {
  if (value) args.push(name, value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
