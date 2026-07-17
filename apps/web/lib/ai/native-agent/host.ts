import { getAgentRegistry } from "@openloomi/ai/agent/registry";
import type { NativeAgentHost } from "@openloomi/ai/agent/native-runner";
import { getDocument, getDocumentChunks } from "@/lib/ai/rag/langchain-service";
import { getUserLlmProviderConfig } from "@/lib/ai/user-llm-api-settings";
import {
  getInsightsWithNotesAndDocuments,
  getUserInsightSettings,
} from "@/lib/db/queries";
import { readFile } from "@/lib/storage";
import { detectSudoPasswordPrompt } from "./sudo";
import { resolveNativeAgentProviderRequest } from "./provider-env";
import { registerNativeAgentProvider } from "./register-provider";

/**
 * App-owned adapters for the package-level native agent runner.
 *
 * The package runner owns execution flow; this host object supplies OpenLoomi's
 * app concerns: provider registration, user settings, RAG storage, focused
 * insight enrichment, and sudo prompt detection.
 */
export const nativeAgentHost: NativeAgentHost = {
  registry: getAgentRegistry(),
  registerProvider: registerNativeAgentProvider,
  prepareRequest: (body) => resolveNativeAgentProviderRequest(body),
  getUserInsightSettings,
  getUserLlmProviderConfig,
  getDocument,
  getDocumentChunks,
  readFile,
  getFocusedInsightsWithNotesAndDocuments: getInsightsWithNotesAndDocuments,
  detectPasswordPrompt: detectSudoPasswordPrompt,
  logger: console,
};
