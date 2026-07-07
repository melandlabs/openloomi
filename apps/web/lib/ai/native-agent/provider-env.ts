import {
  NativeAgentRequestError,
  type NativeAgentRequest,
} from "@openloomi/ai/agent/native-runner";
import type { AgentProvider } from "@openloomi/ai/agent/types";

type EnvSource = Record<string, string | undefined>;

const DEFAULT_AGENT_PROVIDER: AgentProvider = "claude";
const ENV_PROVIDER_KEY = "OPENLOOMI_AGENT_PROVIDER";
const OPENCODE_PROVIDER = "opencode";
const HERMES_PROVIDER = "hermes";
const SUPPORTED_ENV_PROVIDERS = new Set([
  "claude",
  OPENCODE_PROVIDER,
  HERMES_PROVIDER,
]);

export function getConfiguredDefaultAgentProvider(
  env: EnvSource = process.env,
): AgentProvider {
  const provider = resolveEnvAgentProvider(env) ?? DEFAULT_AGENT_PROVIDER;
  if (provider === HERMES_PROVIDER) {
    validateHermesUnsupportedEnvConfig(env);
  }
  return provider;
}

export function resolveNativeAgentProviderRequest(
  body: NativeAgentRequest,
  env: EnvSource = process.env,
): NativeAgentRequest {
  const provider =
    resolveRequestAgentProvider(body.provider) ??
    getConfiguredDefaultAgentProvider(env);

  if (provider === HERMES_PROVIDER) {
    return {
      ...body,
      provider,
      modelConfig: resolveHermesModelConfig(body),
      providerConfig: resolveHermesEnvConfig(env).providerConfig,
    };
  }

  if (provider !== OPENCODE_PROVIDER) {
    return {
      ...body,
      provider,
    };
  }

  const opencodeEnvConfig = resolveOpenCodeEnvConfig(env);
  const requestProviderConfig = isRecord(body.providerConfig)
    ? body.providerConfig
    : {};
  const envAllowAutoApprove =
    opencodeEnvConfig.providerConfig.allowAutoApprove === true;
  const requestDisablesAutoApprove =
    requestProviderConfig.allowAutoApprove === false;

  const providerConfig = {
    ...opencodeEnvConfig.providerConfig,
    ...requestProviderConfig,
    allowAutoApprove: envAllowAutoApprove && !requestDisablesAutoApprove,
  };

  const requestModel = normalizeOptionalString(body.modelConfig?.model);
  const modelConfig =
    opencodeEnvConfig.model && !requestModel
      ? { ...body.modelConfig, model: opencodeEnvConfig.model }
      : body.modelConfig;

  return {
    ...body,
    provider,
    modelConfig,
    providerConfig,
  };
}

function resolveRequestAgentProvider(
  provider: NativeAgentRequest["provider"],
): AgentProvider | undefined {
  if (typeof provider !== "string") {
    return undefined;
  }

  const trimmed = provider.trim();
  return trimmed ? (trimmed as AgentProvider) : undefined;
}

function resolveEnvAgentProvider(env: EnvSource): AgentProvider | undefined {
  const rawProvider = normalizeOptionalString(env[ENV_PROVIDER_KEY]);
  if (!rawProvider) {
    return undefined;
  }

  const provider = rawProvider.toLowerCase();
  if (!SUPPORTED_ENV_PROVIDERS.has(provider)) {
    throwConfigError(
      `Unsupported ${ENV_PROVIDER_KEY}: ${rawProvider}. Supported values: claude, opencode, hermes.`,
    );
  }

  return provider as AgentProvider;
}

function resolveHermesModelConfig(body: NativeAgentRequest) {
  const requestModel = normalizeOptionalString(body.modelConfig?.model);
  if (requestModel) {
    throwConfigError(
      "Hermes model selection is not supported by this ACP MVP. Configure Hermes model selection through Hermes profile/config instead.",
    );
  }

  return body.modelConfig;
}

function resolveHermesEnvConfig(env: EnvSource) {
  validateHermesUnsupportedEnvConfig(env);

  const providerConfig: Record<string, unknown> = {};
  const command = normalizeOptionalString(env.OPENLOOMI_AGENT_HERMES_COMMAND);
  const profile = normalizeOptionalString(env.OPENLOOMI_AGENT_HERMES_PROFILE);
  const timeoutMs = parsePositiveIntegerEnv(
    env,
    "OPENLOOMI_AGENT_HERMES_TIMEOUT_MS",
  );

  if (command) {
    providerConfig.hermesPath = command;
  }
  if (profile) {
    providerConfig.profile = profile;
  }
  if (timeoutMs !== undefined) {
    providerConfig.timeoutMs = timeoutMs;
  }

  return {
    providerConfig,
  };
}

function validateHermesUnsupportedEnvConfig(env: EnvSource) {
  if (normalizeOptionalString(env.OPENLOOMI_AGENT_HERMES_MODEL)) {
    throwConfigError(
      "OPENLOOMI_AGENT_HERMES_MODEL is not supported by this ACP MVP. Configure Hermes model selection through Hermes profile/config instead.",
    );
  }

  if (normalizeOptionalString(env.OPENLOOMI_AGENT_HERMES_PROVIDER)) {
    throwConfigError(
      "OPENLOOMI_AGENT_HERMES_PROVIDER is not supported by this ACP MVP. Configure Hermes provider selection through Hermes profile/config instead.",
    );
  }
}

function resolveOpenCodeEnvConfig(env: EnvSource) {
  const providerConfig: Record<string, unknown> = {};
  const command = normalizeOptionalString(env.OPENLOOMI_AGENT_OPENCODE_COMMAND);
  const agent = normalizeOptionalString(env.OPENLOOMI_AGENT_OPENCODE_AGENT);
  const model = normalizeOptionalString(env.OPENLOOMI_AGENT_OPENCODE_MODEL);
  const timeoutMs = parsePositiveIntegerEnv(
    env,
    "OPENLOOMI_AGENT_OPENCODE_TIMEOUT_MS",
  );
  const allowAutoApprove = parseBooleanEnv(
    env,
    "OPENLOOMI_AGENT_OPENCODE_ALLOW_AUTO_APPROVE",
  );

  if (command) {
    providerConfig.opencodePath = command;
  }
  if (agent) {
    providerConfig.agent = agent;
  }
  if (timeoutMs !== undefined) {
    providerConfig.timeoutMs = timeoutMs;
  }
  if (allowAutoApprove !== undefined) {
    providerConfig.allowAutoApprove = allowAutoApprove;
  }

  return {
    model,
    providerConfig,
  };
}

function parseBooleanEnv(env: EnvSource, key: string): boolean | undefined {
  const raw = normalizeOptionalString(env[key]);
  if (!raw) {
    return undefined;
  }

  switch (raw.toLowerCase()) {
    case "true":
    case "1":
      return true;
    case "false":
    case "0":
      return false;
    default:
      throwConfigError(
        `${key} must be one of true, false, 1, or 0. Received: ${raw}.`,
      );
  }
}

function parsePositiveIntegerEnv(
  env: EnvSource,
  key: string,
): number | undefined {
  const raw = normalizeOptionalString(env[key]);
  if (!raw) {
    return undefined;
  }

  if (!/^\d+$/.test(raw)) {
    throwConfigError(`${key} must be a positive integer. Received: ${raw}.`);
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throwConfigError(`${key} must be a positive integer. Received: ${raw}.`);
  }

  return parsed;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function throwConfigError(message: string): never {
  throw new NativeAgentRequestError(message, 500);
}
