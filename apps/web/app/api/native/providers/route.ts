/**
 * Native Providers API Routes
 *
 * Get available agent and sandbox providers
 */

import { NextResponse } from "next/server";
import {
  CLAUDE_METADATA,
  type AgentProviderMetadata,
} from "@openloomi/ai/agent/plugin";
import {
  getAgentRegistry,
  getAllAgentMetadata,
} from "@openloomi/ai/agent/registry";
import { hermesPlugin } from "@/lib/ai/extensions/agent/hermes";
import { opencodePlugin } from "@/lib/ai/extensions/agent/opencode";
import { getConfiguredDefaultAgentProvider } from "@/lib/ai/native-agent/provider-env";

// Register lightweight built-in Agent plugins used by this metadata route.
const registry = getAgentRegistry();
registry.register(opencodePlugin);
registry.register(hermesPlugin);

function getProviderMetadata(): AgentProviderMetadata[] {
  const metadataByType = new Map<string, AgentProviderMetadata>();

  for (const metadata of [
    CLAUDE_METADATA,
    opencodePlugin.metadata,
    hermesPlugin.metadata,
  ]) {
    metadataByType.set(metadata.type, metadata);
  }

  for (const metadata of getAllAgentMetadata()) {
    metadataByType.set(metadata.type, metadata);
  }

  return Array.from(metadataByType.values());
}

// GET /api/native/providers - Get all available providers
export async function GET() {
  try {
    const agentProviders = getProviderMetadata();

    return NextResponse.json({
      agents: agentProviders,
      defaultAgent: getConfiguredDefaultAgentProvider(),
    });
  } catch (error) {
    console.error("[ProvidersAPI] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to get providers",
      },
      { status: 500 },
    );
  }
}
