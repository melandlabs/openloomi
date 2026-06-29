import { getAgentRegistry } from "@openloomi/ai/agent/registry";
import type { NativeAgentHost } from "@openloomi/ai/agent/native-runner";

import { claudePlugin } from "@/lib/ai/extensions";
import { getDocument, getDocumentChunks } from "@/lib/ai/rag/langchain-service";
import { getUserLlmProviderConfig } from "@/lib/ai/user-llm-api-settings";
import {
  getInsightsWithNotesAndDocuments,
  getUserInsightSettings,
} from "@/lib/db/queries";
import { readFile } from "@/lib/storage";
import { detectSudoPasswordPrompt } from "./sudo";

let providersRegistered = false;

function registerNativeAgentProviders() {
  if (providersRegistered) {
    return;
  }

  getAgentRegistry().register(claudePlugin);
  providersRegistered = true;
}

/**
 * App-owned adapters for the package-level native agent runner.
 *
 * The package runner owns execution flow; this host object supplies OpenLoomi's
 * app concerns: provider registration, user settings, RAG storage, focused
 * insight enrichment, and sudo prompt detection.
 */
export const nativeAgentHost: NativeAgentHost = {
  registry: getAgentRegistry(),
  registerProviders: registerNativeAgentProviders,
  getUserInsightSettings,
  getUserLlmProviderConfig,
  getDocument,
  getDocumentChunks,
  readFile,
  getFocusedInsightsWithNotesAndDocuments: getInsightsWithNotesAndDocuments,
  detectPasswordPrompt: detectSudoPasswordPrompt,
  logger: console,
};
