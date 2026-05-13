/**
 * @openloomi/agent/sandbox - Sandbox Provider System
 *
 * Extensible sandbox providers for isolated code execution.
 * Supports: Native (no isolation), Claude (srt), Vercel (MicroVM).
 */

// Types
export type {
  BuiltinSandboxProviderType,
  ISandboxProvider,
  PROVIDER_PRIORITY,
  ProviderSelectionResult,
  SANDBOX_IMAGES,
  SandboxCapabilities,
  SandboxConfig,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxImage,
  SandboxInstance,
  SandboxPlugin,
  SandboxProviderConfig,
  SandboxProviderFactory,
  SandboxProviderMetadata,
  SandboxProviderRegistry,
  SandboxProviderType,
  ScriptOptions,
  VolumeMount,
} from "./types";

// Plugin system
export {
  BaseSandboxProvider,
  defineSandboxPlugin,
  detectRuntime,
  getCodexConfigSchema,
  getClaudeConfigSchema,
  getNativeConfigSchema,
  getContainerScriptPath,
  isCommandAvailable,
} from "./plugin";

// Registry
export {
  createSandboxProvider,
  getAvailableSandboxProviders,
  getSandboxProvider,
  getSandboxRegistry,
  registerSandboxProvider,
  stopAllSandboxProviders,
} from "./registry";

// Providers
export {
  NativeProvider,
  createNativeProvider,
  nativePlugin,
} from "./providers/native";

export {
  ClaudeProvider,
  claudePlugin,
  createClaudeProvider,
} from "./providers/claude";

export {
  VercelProvider,
  createVercelProvider,
  vercelPlugin,
} from "./providers/vercel";
