/**
 * Extensions
 *
 * Central export point for all extensions (agents, sandboxes, etc.)
 */

export { claudePlugin, createClaudeAgent, ClaudeAgent } from "./agent/claude";
export {
  opencodePlugin,
  createOpenCodeAgent,
  OpenCodeAgent,
} from "./agent/opencode";
export { hermesPlugin, createHermesAgent, HermesAgent } from "./agent/hermes";
export {
  openclawPlugin,
  createOpenClawAgent,
  OpenClawAgent,
} from "./agent/openclaw";
