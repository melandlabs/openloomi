import { getAgentRegistry } from "@openloomi/ai/agent/registry";
import { NativeAgentRequestError } from "@openloomi/ai/agent/native-runner";
import type { AgentPlugin } from "@openloomi/ai/agent/plugin";
import type { AgentProvider } from "@openloomi/ai/agent/types";

type ProviderLoader = () => Promise<AgentPlugin>;

const PROVIDER_LOADERS: Record<string, ProviderLoader> = {
  claude: async () => {
    const { claudePlugin } = await import("@/lib/ai/extensions/agent/claude");
    return claudePlugin;
  },
  codex: async () => {
    const { codexPlugin } = await import("@/lib/ai/extensions/agent/codex");
    return codexPlugin;
  },
  hermes: async () => {
    const { hermesPlugin } = await import("@/lib/ai/extensions/agent/hermes");
    return hermesPlugin;
  },
  openclaw: async () => {
    const { openclawPlugin } =
      await import("@/lib/ai/extensions/agent/openclaw");
    return openclawPlugin;
  },
  opencode: async () => {
    const { opencodePlugin } =
      await import("@/lib/ai/extensions/agent/opencode");
    return opencodePlugin;
  },
};

const registrationPromises = new Map<string, Promise<void>>();

/**
 * Load and register exactly one native provider.
 *
 * Keeping each dynamic import pointed at the provider module (instead of the
 * extensions barrel) is important: the packaged one-shot bundle must not
 * initialize unrelated SDKs before provider selection.
 */
export async function registerNativeAgentProvider(provider: AgentProvider) {
  const registry = getAgentRegistry();
  if (registry.has(provider)) {
    return;
  }

  const existing = registrationPromises.get(provider);
  if (existing) {
    await existing;
    return;
  }

  const loader = PROVIDER_LOADERS[provider];
  if (!loader) {
    throw new NativeAgentRequestError(
      `Unsupported native agent provider: ${provider}.`,
      500,
    );
  }

  const registration = loader().then((plugin) => registry.register(plugin));

  registrationPromises.set(provider, registration);
  try {
    await registration;
  } finally {
    // This map only deduplicates concurrent imports. The registry remains the
    // source of truth, so an explicitly unregistered provider can be loaded
    // again later and failed imports remain retryable.
    if (registrationPromises.get(provider) === registration) {
      registrationPromises.delete(provider);
    }
  }
}
