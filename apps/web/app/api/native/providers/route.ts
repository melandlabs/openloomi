/**
 * Native Providers API Routes
 *
 * Get available agent and sandbox providers
 */

import { NextResponse } from "next/server";
import { getAgentRegistry } from "@openloomi/ai/agent/registry";
import { getAllAgentMetadata } from "@openloomi/ai/agent/registry";
import { claudePlugin } from "@/lib/ai/extensions";

// Register Claude Agent plugin
getAgentRegistry().register(claudePlugin);

// GET /api/native/providers - Get all available providers
export async function GET() {
  try {
    const agentProviders = getAllAgentMetadata();

    return NextResponse.json({
      agents: agentProviders,
      defaultAgent: "claude",
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
