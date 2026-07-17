#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BRIDGE_VERSION = "0.7.9";
const PLUGIN_PHASE = "runtime-provider-readiness";
const COMMAND_TIMEOUT_MS = 5000;
const RUN_TIMEOUT_MS = 120000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const RELEASE_LOOKUP_TIMEOUT_MS = 30000;
const INSTALL_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const DOWNLOAD_STALL_TIMEOUT_MS = 30000;
const SESSION_BOOTSTRAP_TIMEOUT_MS = 30000;
const SESSION_BOOTSTRAP_POLL_MS = 2000;
const SESSION_API_TIMEOUT_MS = 5000;
const API_PROBE_TIMEOUT_MS = 1000;
const CONNECTOR_STATUS_TIMEOUT_MS = 2500;
const MAX_COMMAND_OUTPUT = 4096;
const RUN_LOCK_TTL_MS = RUN_TIMEOUT_MS + 60_000;
const DEBUG_DISCOVERY = process.env.OPENLOOMI_DEBUG_DISCOVERY === "1";
const MONITORING_CONNECTOR_IDS = new Set([
  "gmail",
  "google_calendar",
  "github",
  "slack",
  "linear",
]);
const NATIVE_CONNECTOR_LABELS = {
  asana: "Asana",
  dingtalk: "DingTalk",
  discord: "Discord",
  facebook_messenger: "Messenger",
  feishu: "Feishu",
  github: "GitHub",
  gmail: "Gmail",
  google_calendar: "Google Calendar",
  google_docs: "Google Docs",
  google_drive: "Google Drive",
  google_meet: "Google Meet",
  hubspot: "HubSpot",
  imessage: "iMessage",
  instagram: "Instagram",
  jira: "Jira",
  linear: "Linear",
  linkedin: "LinkedIn",
  notion: "Notion",
  outlook: "Outlook",
  outlook_calendar: "Outlook Calendar",
  qqbot: "QQ",
  slack: "Slack",
  teams: "Teams",
  telegram: "Telegram",
  twitter: "X",
  weixin: "Weixin",
  whatsapp: "WhatsApp",
};
const OFFICIAL_RELEASE_SOURCE = {
  owner: "melandlabs",
  repo: "openloomi",
  latestReleaseApi:
    "https://api.github.com/repos/melandlabs/openloomi/releases/latest",
  releasePage: "https://github.com/melandlabs/openloomi/releases",
};

const RUNTIME_SAFE_PROMPT_GUARD = [
  "You are already inside the OpenLoomi runtime.",
  "Do not call tools, shell, skills, Codex plugins, OpenLoomi plugins, or loomi-bridge.",
].join(" ");

const COMMANDS = new Set([
  "codex-runtime-info",
  "configure-ai-provider",
  "help",
  "initialize-session",
  "install-openloomi",
  "install-instructions",
  "pet",
  "run",
  "set-codex-runtime-env",
  "setup",
  "setup-status",
  "state",
  "version",
  "workflow-guidance",
]);

// Shared 9-state sprite vocabulary used by both the Claude plugin
// (`cmdPet` in plugins/claude/scripts/loomi-bridge.mjs) and the Codex
// plugin. The desktop runtime's /api/pet/state endpoint accepts any of
// these strings and ignores anything else with a 400.
const CAPYBARA_STATES = new Set([
  "happy",
  "idle",
  "juggling",
  "needsinput",
  "presenting",
  "sleeping",
  "sweeping",
  "thinking",
  "working",
]);
const CAPYBARA_STATES_LIST = [...CAPYBARA_STATES];
const PET_HTTP_TIMEOUT_MS = 2000;

const WORKFLOW_GUIDANCE = [
  {
    id: "openloomi-loop",
    aliases: ["loop", "attention-loop", "follow-up"],
    title: "OpenLoomi Loop",
    description:
      "Guide attention-loop, prioritization, wrap-up, and follow-up workflows through the local OpenLoomi runtime.",
    wrapperSkill: "openloomi-loop",
    readyRequired: true,
    bridgeCommand: "run",
    taskPromptPrefix: `${RUNTIME_SAFE_PROMPT_GUARD} Treat the user request as a loop planning request. Return the final planning result only.`,
    nextActionsWhenBlocked: [
      "install_openloomi",
      "initialize_openloomi_session",
      "configure_ai_provider",
      "configure_connectors",
    ],
    safety: [
      "Do not implement loop scheduling or decision storage in the Codex plugin.",
      "Pass the user task over stdin to the bridge run command when ready.",
    ],
  },
  {
    id: "openloomi-memory",
    aliases: ["memory", "memories", "recall", "remember"],
    title: "OpenLoomi Memory",
    description:
      "Guide memory search, recall, write, and context workflows through OpenLoomi-owned memory surfaces.",
    wrapperSkill: "openloomi-memory",
    readyRequired: true,
    bridgeCommand: "run",
    taskPromptPrefix: `${RUNTIME_SAFE_PROMPT_GUARD} Treat the user request as a memory/context request. Return only the runtime result; do not read or write memory files directly.`,
    nextActionsWhenBlocked: [
      "install_openloomi",
      "initialize_openloomi_session",
      "configure_ai_provider",
      "configure_connectors",
    ],
    safety: [
      "Do not read or write OpenLoomi memory files directly from the Codex plugin.",
      "Do not expose memory contents unless OpenLoomi runtime returns them for the requested task.",
    ],
  },
  {
    id: "openloomi-connectors",
    aliases: ["connectors", "connector", "integrations", "slack", "gmail"],
    title: "OpenLoomi Connectors",
    description:
      "Guide connector readiness checks and setup handoffs for Slack, Gmail, Calendar, GitHub, and other OpenLoomi integrations.",
    wrapperSkill: "openloomi-connectors",
    readyRequired: false,
    bridgeCommand: "setup-status",
    taskPromptPrefix:
      "Use OpenLoomi connector readiness workflow. Report setup status only and keep OAuth or API secrets inside OpenLoomi-owned surfaces.",
    nextActionsWhenBlocked: [
      "install_openloomi",
      "initialize_openloomi_session",
      "configure_connectors",
    ],
    safety: [
      "Do not ask the user to paste connector OAuth tokens or API secrets into Codex.",
      "Report connector readiness as status and next action only.",
    ],
  },
  {
    id: "openloomi-handoff",
    aliases: ["handoff", "followup", "delegate", "send-to-loomi"],
    title: "OpenLoomi Handoff",
    description:
      "Guide handoff workflows that send the current Codex task to OpenLoomi for follow-up, reminders, or later attention.",
    wrapperSkill: "openloomi-handoff",
    readyRequired: true,
    bridgeCommand: "run",
    taskPromptPrefix: `${RUNTIME_SAFE_PROMPT_GUARD} Treat the user request as a handoff or follow-up request. Return the final runtime result only.`,
    nextActionsWhenBlocked: [
      "install_openloomi",
      "initialize_openloomi_session",
      "configure_ai_provider",
      "configure_connectors",
    ],
    safety: [
      "Do not build an independent task queue in the Codex plugin.",
      "Keep handoff persistence inside OpenLoomi runtime.",
    ],
  },
];

class BridgeError extends Error {
  constructor(reason, message, details = {}) {
    super(message);
    this.name = "BridgeError";
    this.reason = reason;
    this.details = details;
  }
}

function writeJson(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = exitCode;
}

async function setupStatus() {
  writeJson(await buildSetupStatus());
}

async function getCodexRuntimeEnvStatus() {
  const probe = await probeRuntimeEnvValue(RUNTIME_ENV_KEY);
  const value = probe.value;
  const set = value === "codex";
  // Writing the launchd/environment.d value only affects processes started
  // *after* the write. The currently running OpenLoomi GUI (if any) will not
  // see the change until Quit + reopen. We surface that here so callers can
  // tell the user to restart.
  return {
    set,
    value,
    source: probe.source,
    key: RUNTIME_ENV_KEY,
    requiresRestart: !set && value !== null, // changed away from codex - must restart GUI to clear
    persistenceProbe: probePersistenceState(),
  };
}

// Lightweight, unconditional reachability probe. Hits the runtime's
// guest endpoint (the same one `initialize-session` will mint through)
// and treats any HTTP response - including 4xx - as "the daemon is
// listening". Used by `buildSetupStatus` to populate `apiProbe` and
// `apiReachable` independently of whether a session token is present.
//
// Result shape (consumed by tests/bridge.test.mjs):
//   {
//     reachableUrl: <first URL that answered> | null,
//     attempts: [
//       { baseUrl, reason: 'HTTP_RESPONSE' | 'TIMEOUT' | 'NETWORK_ERROR', status?, error? }
//     ]
//   }
async function probeApiReachable() {
  const urls = getLocalApiBaseUrls();
  const attempts = [];

  for (const baseUrl of urls) {
    try {
      const res = await fetch(`${baseUrl}/api/remote-auth/guest`, {
        method: "POST",
        signal: AbortSignal.timeout(1500),
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      attempts.push({
        baseUrl,
        reason: "HTTP_RESPONSE",
        status: res.status,
      });
      return {
        reachableUrl: baseUrl,
        attempts,
      };
    } catch (e) {
      const isAbort =
        e && (e.name === "AbortError" || e.name === "TimeoutError");
      attempts.push({
        baseUrl,
        reason: isAbort ? "TIMEOUT" : "NETWORK_ERROR",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    reachableUrl: null,
    attempts,
  };
}

async function buildSetupStatus() {
  const discovery = await discoverOpenLoomi();
  const token = getTokenStatus();
  const aiProvider = await getAiProviderStatus(token);
  const codexRuntimeEnv = await getCodexRuntimeEnvStatus();
  const apiProbe = await probeApiReachable();
  const runtimeBaseUrl = normalizeLocalApiUrl(aiProvider.runtime?.baseUrl);

  if (!apiProbe.reachableUrl && runtimeBaseUrl) {
    apiProbe.reachableUrl = runtimeBaseUrl;
    apiProbe.source = "aiProviderRuntime";
  }

  const connectorStatus = await getConnectorStatus(
    apiProbe.reachableUrl,
    token,
  );
  const nativeProviderStatus = await getNativeProviderStatus(
    apiProbe.reachableUrl,
  );
  const executionProvider = getExecutionProviderStatus(
    aiProvider,
    nativeProviderStatus,
  );

  const baseStatus = {
    mode: discovery.mode,
    installed: discovery.installed,
    ctlPath: discovery.ctlPath,
    version: discovery.version,
    tokenPresent: token.present,
    aiProviderConfigured: aiProvider.configured,
    aiProviderStatus: aiProvider.status,
    executionProviderReady: executionProvider.ready,
    executionProviderSource: executionProvider.source,
    nativeRuntimeActive: nativeProviderStatus.active,
    nativeRuntimeProvider: nativeProviderStatus.defaultAgent,
    nativeRuntimeStatus: nativeProviderStatus.reason,
    nativeRuntime: {
      checked: nativeProviderStatus.checked,
      available: nativeProviderStatus.available,
      active: nativeProviderStatus.active,
      reason: nativeProviderStatus.reason,
      baseUrl: nativeProviderStatus.baseUrl,
      endpoint: nativeProviderStatus.endpoint,
      defaultAgent: nativeProviderStatus.defaultAgent,
      codexAgentAvailable: nativeProviderStatus.codexAgentAvailable,
      agents: nativeProviderStatus.agents,
    },
    connectorStatusAvailable: connectorStatus.available,
    connectors: connectorStatus.connectors,
    connectorSetupRecommended: connectorStatus.setupRecommended,
    recommendedNextAction: connectorStatus.recommendedNextAction,
    recommendedReason: connectorStatus.recommendedReason,
    connectorSetupUrl: connectorStatus.setupUrl,
    connectorStatus: {
      checked: connectorStatus.checked,
      available: connectorStatus.available,
      reason: connectorStatus.reason,
      baseUrl: connectorStatus.baseUrl,
      endpoint: connectorStatus.endpoint,
      connectedCount: connectorStatus.connectedCount,
      monitoringConnected: connectorStatus.monitoringConnected,
      monitoringConnectorIds: [...MONITORING_CONNECTOR_IDS],
    },
    apiReachable: Boolean(apiProbe.reachableUrl),
    apiBaseUrl: apiProbe.reachableUrl,
    apiProbe: {
      reachableUrl: apiProbe.reachableUrl,
      attempts: apiProbe.attempts,
      source: apiProbe.source,
    },
    codexRuntimeEnvSet: codexRuntimeEnv.set,
    codexRuntimeEnv: {
      key: codexRuntimeEnv.key,
      value: codexRuntimeEnv.value,
      source: codexRuntimeEnv.source,
      requiresRestart: codexRuntimeEnv.requiresRestart,
      persistenceProbe: codexRuntimeEnv.persistenceProbe,
    },
    session: {
      tokenPresent: token.present,
      guestBootstrapSupported: true,
      guestBootstrapMode: "local-openloomi-api",
    },
    discoverySource: discovery.source,
    sourceRoot: DEBUG_DISCOVERY ? discovery.sourceRoot : null,
    sourceRootPresent: Boolean(discovery.sourceRoot),
    bridge: {
      name: "openloomi-codex-bridge",
      version: BRIDGE_VERSION,
      phase: PLUGIN_PHASE,
    },
    checks: {
      auth: token.checked,
      aiProvider: aiProvider.checked,
      aiProviderRuntime: aiProvider.runtime,
      nativeProvider: nativeProviderStatus,
      apiProbe: apiProbe.attempts,
      connectors: connectorStatus.check,
      discovery: discovery.checked,
      codexRuntimeEnv: {
        key: codexRuntimeEnv.key,
        present: codexRuntimeEnv.set,
        value: codexRuntimeEnv.value,
        source: codexRuntimeEnv.source,
      },
    },
  };

  return {
    ...baseStatus,
    ...getReadinessDecision(
      discovery,
      token,
      aiProvider,
      codexRuntimeEnv,
      apiProbe,
      nativeProviderStatus,
    ),
  };
}

async function getNativeProviderStatus(baseUrl) {
  const normalizedBaseUrl = normalizeLocalApiUrl(baseUrl);
  const endpoint = "/api/native/providers";

  if (!normalizedBaseUrl) {
    return buildNativeProviderStatus({
      checked: false,
      available: false,
      reason: "OPENLOOMI_API_UNREACHABLE",
      baseUrl: null,
      endpoint,
    });
  }

  if (typeof fetch !== "function") {
    return buildNativeProviderStatus({
      checked: true,
      available: false,
      reason: "FETCH_UNAVAILABLE",
      baseUrl: normalizedBaseUrl,
      endpoint,
    });
  }

  try {
    const response = await fetchWithTimeout(
      `${normalizedBaseUrl}${endpoint}`,
      {
        headers: {
          Accept: "application/json",
        },
        redirect: "manual",
      },
      API_PROBE_TIMEOUT_MS,
    );

    if (!response.ok) {
      return buildNativeProviderStatus({
        checked: true,
        available: false,
        reason: `NATIVE_PROVIDERS_HTTP_${response.status}`,
        baseUrl: normalizedBaseUrl,
        endpoint,
        status: response.status,
      });
    }

    const payload = await response.json().catch(() => null);
    const agents = Array.isArray(payload?.agents)
      ? payload.agents.map(summarizeNativeAgent)
      : [];
    const defaultAgent =
      typeof payload?.defaultAgent === "string" ? payload.defaultAgent : null;
    const codexAgentAvailable = agents.some(
      (agent) => agent.type === CODEX_RUNTIME_PROVIDER,
    );
    const active =
      defaultAgent === CODEX_RUNTIME_PROVIDER && codexAgentAvailable;

    return buildNativeProviderStatus({
      checked: true,
      available: true,
      active,
      reason: active ? "CODEX_RUNTIME_ACTIVE" : "CODEX_RUNTIME_INACTIVE",
      baseUrl: normalizedBaseUrl,
      endpoint,
      status: response.status,
      defaultAgent,
      codexAgentAvailable,
      agents,
    });
  } catch (error) {
    return buildNativeProviderStatus({
      checked: true,
      available: false,
      reason: error?.name === "AbortError" ? "API_TIMEOUT" : "API_UNREACHABLE",
      baseUrl: normalizedBaseUrl,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildNativeProviderStatus({
  checked,
  available,
  active = false,
  reason,
  baseUrl,
  endpoint,
  status = null,
  defaultAgent = null,
  codexAgentAvailable = false,
  agents = [],
  error = null,
}) {
  return {
    checked,
    available,
    active,
    reason,
    baseUrl,
    endpoint,
    status,
    defaultAgent,
    codexAgentAvailable,
    agents,
    error,
  };
}

function summarizeNativeAgent(agent) {
  return {
    type: typeof agent?.type === "string" ? agent.type : null,
    name: typeof agent?.name === "string" ? agent.name : null,
  };
}

function getExecutionProviderStatus(aiProvider, nativeProvider) {
  if (aiProvider.configured) {
    return {
      ready: true,
      source: "ai_provider",
    };
  }

  if (nativeProvider.active) {
    return {
      ready: true,
      source: "native_codex_runtime",
    };
  }

  return {
    ready: false,
    source: null,
  };
}

async function getConnectorStatus(baseUrl, tokenStatus) {
  const normalizedBaseUrl = normalizeLocalApiUrl(baseUrl);
  const endpoint = "/api/loop/connectors";
  const setupUrl = normalizedBaseUrl ? `${normalizedBaseUrl}/connectors` : null;

  if (!normalizedBaseUrl) {
    return buildConnectorStatus({
      checked: false,
      available: false,
      reason: "OPENLOOMI_API_UNREACHABLE",
      baseUrl: null,
      endpoint,
      setupUrl,
    });
  }

  if (typeof fetch !== "function") {
    return buildConnectorStatus({
      checked: true,
      available: false,
      reason: "FETCH_UNAVAILABLE",
      baseUrl: normalizedBaseUrl,
      endpoint,
      setupUrl,
    });
  }

  const nativeStatus = await getNativeIntegrationConnectorStatus(
    normalizedBaseUrl,
    tokenStatus,
  );

  try {
    const response = await fetchWithTimeout(
      `${normalizedBaseUrl}${endpoint}`,
      {
        headers: {
          Accept: "application/json",
        },
        redirect: "manual",
      },
      CONNECTOR_STATUS_TIMEOUT_MS,
    );

    if (!response.ok) {
      return buildConnectorStatusWithNativeFallback(
        {
          checked: true,
          available: false,
          reason: `CONNECTOR_STATUS_HTTP_${response.status}`,
          status: response.status,
          baseUrl: normalizedBaseUrl,
          endpoint,
          setupUrl,
        },
        nativeStatus,
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      return buildConnectorStatusWithNativeFallback(
        {
          checked: true,
          available: false,
          reason: "CONNECTOR_STATUS_MALFORMED_RESPONSE",
          status: response.status,
          baseUrl: normalizedBaseUrl,
          endpoint,
          setupUrl,
        },
        nativeStatus,
      );
    }

    const rawConnectors = extractConnectorList(payload);

    if (!rawConnectors) {
      return buildConnectorStatusWithNativeFallback(
        {
          checked: true,
          available: false,
          reason: "CONNECTOR_STATUS_MISSING_ITEMS",
          status: response.status,
          baseUrl: normalizedBaseUrl,
          endpoint,
          setupUrl,
        },
        nativeStatus,
      );
    }

    const connectors = mergeConnectorEntries(
      rawConnectors.map(summarizeConnectorEntry).filter(Boolean),
      nativeStatus.connectors,
    );

    return buildConnectorStatus({
      checked: true,
      available: true,
      reason: nativeStatus.available
        ? "CONNECTOR_STATUS_LOADED_WITH_NATIVE_INTEGRATIONS"
        : "CONNECTOR_STATUS_LOADED",
      status: response.status,
      baseUrl: normalizedBaseUrl,
      endpoint,
      setupUrl,
      connectors,
      sources: nativeStatus.available
        ? ["loop-connectors", "native-integrations"]
        : ["loop-connectors"],
      nativeReason: nativeStatus.reason,
    });
  } catch (error) {
    return buildConnectorStatusWithNativeFallback(
      {
        checked: true,
        available: false,
        reason:
          error && error.name === "AbortError"
            ? "CONNECTOR_STATUS_TIMEOUT"
            : "CONNECTOR_STATUS_UNREACHABLE",
        baseUrl: normalizedBaseUrl,
        endpoint,
        setupUrl,
      },
      nativeStatus,
    );
  }
}

function buildConnectorStatusWithNativeFallback(baseStatus, nativeStatus) {
  if (nativeStatus.available) {
    return buildConnectorStatus({
      ...baseStatus,
      available: true,
      reason: `${baseStatus.reason}_WITH_NATIVE_INTEGRATIONS`,
      connectors: nativeStatus.connectors,
      sources: ["native-integrations"],
      nativeReason: nativeStatus.reason,
    });
  }

  return buildConnectorStatus({
    ...baseStatus,
    sources: [],
    nativeReason: nativeStatus.reason,
  });
}

async function getNativeIntegrationConnectorStatus(baseUrl, tokenStatus) {
  const endpoint = "/api/integrations";

  if (!tokenStatus?.present) {
    return {
      available: false,
      reason: "NATIVE_INTEGRATIONS_TOKEN_MISSING",
      connectors: [],
    };
  }

  const token = readOpenLoomiAuthToken(tokenStatus);

  if (!hasValue(token)) {
    return {
      available: false,
      reason: "NATIVE_INTEGRATIONS_TOKEN_UNREADABLE",
      connectors: [],
    };
  }

  try {
    const sessionResponse = await fetchWithTimeout(
      `${baseUrl}/api/auth/set-token?token=${encodeURIComponent(token)}`,
      {
        method: "GET",
        redirect: "manual",
      },
      SESSION_API_TIMEOUT_MS,
    );
    const cookieHeader = toCookieHeader(
      getSetCookieHeaders(sessionResponse.headers),
    );

    if (!cookieHeader) {
      return {
        available: false,
        reason: "NATIVE_INTEGRATIONS_SESSION_COOKIE_MISSING",
        connectors: [],
      };
    }

    const response = await fetchWithTimeout(
      `${baseUrl}${endpoint}`,
      {
        headers: {
          Accept: "application/json",
          Cookie: cookieHeader,
        },
        redirect: "manual",
      },
      CONNECTOR_STATUS_TIMEOUT_MS,
    );

    if (!response.ok) {
      return {
        available: false,
        reason: `NATIVE_INTEGRATIONS_HTTP_${response.status}`,
        connectors: [],
      };
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      return {
        available: false,
        reason: "NATIVE_INTEGRATIONS_MALFORMED_RESPONSE",
        connectors: [],
      };
    }

    const accounts = Array.isArray(payload?.accounts) ? payload.accounts : null;

    if (!accounts) {
      return {
        available: false,
        reason: "NATIVE_INTEGRATIONS_MISSING_ACCOUNTS",
        connectors: [],
      };
    }

    return {
      available: true,
      reason: "NATIVE_INTEGRATIONS_LOADED",
      connectors: summarizeNativeIntegrationAccounts(accounts),
    };
  } catch (error) {
    return {
      available: false,
      reason:
        error && error.name === "AbortError"
          ? "NATIVE_INTEGRATIONS_TIMEOUT"
          : "NATIVE_INTEGRATIONS_UNREACHABLE",
      connectors: [],
    };
  }
}

function summarizeNativeIntegrationAccounts(accounts) {
  const counts = new Map();

  for (const account of accounts) {
    if (!account || typeof account !== "object") {
      continue;
    }

    const id = normalizeConnectorId(account.platform);

    if (!id || !isNativeIntegrationConnected(account)) {
      continue;
    }

    counts.set(id, (counts.get(id) || 0) + 1);
  }

  return [...counts.entries()].map(([id, accountCount]) => ({
    id,
    label: NATIVE_CONNECTOR_LABELS[id] || formatConnectorLabel(id),
    connected: true,
    accountCount,
  }));
}

function isNativeIntegrationConnected(account) {
  const status =
    typeof account.status === "string" ? account.status.toLowerCase() : "";

  return !["disabled", "disconnected", "revoked", "error"].includes(status);
}

function mergeConnectorEntries(primary, secondary) {
  const byId = new Map();

  for (const connector of [...primary, ...secondary]) {
    if (!connector?.id) {
      continue;
    }

    const existing = byId.get(connector.id);

    if (!existing) {
      byId.set(connector.id, connector);
      continue;
    }

    byId.set(connector.id, {
      ...existing,
      ...connector,
      connected: Boolean(existing.connected || connector.connected),
      accountCount: Math.max(
        existing.accountCount || 0,
        connector.accountCount || 0,
      ),
      lastError: connector.connected
        ? undefined
        : existing.lastError || connector.lastError,
    });
  }

  return [...byId.values()].map((connector) => {
    if (connector.lastError === undefined) {
      const { lastError, ...rest } = connector;
      return rest;
    }

    return connector;
  });
}

function buildConnectorStatus({
  checked,
  available,
  reason,
  status = null,
  baseUrl,
  endpoint,
  setupUrl,
  connectors = [],
  sources = [],
  nativeReason = null,
}) {
  const connectedCount = connectors.filter(
    (connector) => connector.connected,
  ).length;
  const monitoringConnectors = connectors.filter((connector) =>
    MONITORING_CONNECTOR_IDS.has(connector.id),
  );
  const monitoringConnected = monitoringConnectors.some(
    (connector) => connector.connected,
  );
  const setupRecommended = Boolean(
    (!available && checked && setupUrl) || (available && connectedCount === 0),
  );

  return {
    checked,
    available,
    reason,
    status,
    baseUrl,
    endpoint,
    setupUrl,
    connectors,
    connectedCount,
    monitoringConnected,
    sources,
    nativeReason,
    setupRecommended,
    recommendedNextAction: setupRecommended ? "configure_connectors" : null,
    recommendedReason: setupRecommended ? "CONNECTOR_SETUP_REQUIRED" : null,
    check: {
      checked,
      available,
      reason,
      status,
      baseUrl,
      endpoint,
      connectedCount,
      monitoringConnected,
      sources,
      nativeReason,
      setupRecommended,
    },
  };
}

function extractConnectorList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  if (Array.isArray(payload?.connectors)) {
    return payload.connectors;
  }

  return null;
}

function normalizeConnectorId(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function formatConnectorLabel(id) {
  return id
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function summarizeConnectorEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = normalizeConnectorId(entry.id);

  if (!id) {
    return null;
  }

  const label =
    typeof entry.label === "string" && entry.label.trim()
      ? entry.label.trim()
      : id;
  const accountCount = normalizeConnectorAccountCount(entry.accountCount);
  const connector = {
    id,
    label,
    connected: Boolean(entry.connected),
    accountCount,
  };
  const lastError = sanitizeConnectorLastError(entry.lastError);

  if (lastError) {
    connector.lastError = lastError;
  }

  if (typeof entry.probed === "boolean") {
    connector.probed = entry.probed;
  }

  if (typeof entry.fetchedAt === "string" && entry.fetchedAt.trim()) {
    connector.fetchedAt = entry.fetchedAt.trim();
  }

  return connector;
}

function normalizeConnectorAccountCount(value) {
  const count = Number(value);

  if (!Number.isFinite(count) || count < 0) {
    return 0;
  }

  return Math.floor(count);
}

function sanitizeConnectorLastError(value) {
  if (!hasValue(value)) {
    return null;
  }

  const text = String(value).replace(/\s+/g, " ").trim();

  if (!text) {
    return null;
  }

  if (/token|secret|password|authorization|bearer|api[_-]?key/i.test(text)) {
    return "redacted";
  }

  return text.slice(0, 160);
}

function installInstructions() {
  const plan = getInstallPlan();

  writeJson({
    nextAction: "install_openloomi",
    reason: "INSTALL_REQUIRED",
    ready: false,
    installPlan: plan,
    instructions: [
      "Install OpenLoomi from the official release artifact or provide a source checkout with a staged openloomi-ctl.",
      "The bridge will not download or install OpenLoomi unless install-openloomi is called with --confirm.",
      "On supported platforms, install-openloomi --confirm downloads the official artifact and installs it with the default installer path.",
      "After installation, re-run setup-status from the Codex plugin.",
    ],
    bridge: {
      name: "openloomi-codex-bridge",
      version: BRIDGE_VERSION,
      phase: PLUGIN_PHASE,
    },
  });
}

async function installOpenLoomi(args) {
  const flags = parseFlags(args);
  const plan = getInstallPlan();

  if (!flags.confirm) {
    writeJson({
      ready: false,
      nextAction: "confirm_install_openloomi",
      reason: "INSTALL_CONFIRMATION_REQUIRED",
      installPlan: plan,
      command:
        "install-openloomi --confirm [--sha256 <sha256>] [--download-only] [--launch]",
      safety:
        "No download or installation has been performed. Re-run with --confirm to resolve, download, and install the official OpenLoomi release artifact with the default installer path.",
    });
    return;
  }

  if (flags.downloadOnly && flags.launch) {
    writeJson(
      {
        ready: false,
        nextAction: "choose_install_mode",
        reason: "INVALID_INSTALL_FLAGS",
        message:
          "Use either --download-only or --launch, not both. Omit both for default automatic installation.",
      },
      1,
    );
    return;
  }

  let artifact;

  try {
    artifact = flags.artifactUrl
      ? getManualInstallerArtifact(flags.artifactUrl)
      : await resolveOfficialInstallerArtifact();
  } catch (error) {
    const normalized = normalizeBridgeError(
      error,
      "ARTIFACT_RESOLUTION_FAILED",
    );

    writeJson(
      {
        ready: false,
        nextAction: "retry_install_openloomi",
        reason: normalized.reason,
        installPlan: plan,
        message: normalized.message,
        ...normalized.details,
      },
      1,
    );
    return;
  }

  const argumentSha256 = flags.sha256 ? normalizeSha256(flags.sha256) : null;

  if (flags.sha256 && !argumentSha256) {
    writeJson(
      {
        ready: false,
        nextAction: "provide_valid_checksum",
        reason: "INVALID_SHA256_ARGUMENT",
        message:
          "The --sha256 value must be a 64-character SHA-256 hex digest, optionally prefixed with sha256:.",
        downloaded: false,
        installed: false,
        launched: false,
        artifact: summarizeArtifact(artifact),
      },
      1,
    );
    return;
  }

  let download;

  try {
    download = await downloadInstallerArtifact(artifact);
  } catch (error) {
    const normalized = normalizeBridgeError(error, "DOWNLOAD_FAILED");

    writeJson(
      {
        ready: false,
        nextAction: "retry_install_openloomi",
        reason: normalized.reason,
        message: normalized.message,
        artifact: summarizeArtifact(artifact),
        downloaded: false,
        launched: false,
        ...normalized.details,
      },
      1,
    );
    return;
  }

  const expectedSha256 = argumentSha256 || artifact.sha256;
  const sha256Source = flags.sha256
    ? "argument"
    : artifact.sha256
      ? "github-release-digest"
      : null;

  if (expectedSha256) {
    const actualSha256 = await sha256File(download.path);

    if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
      writeJson(
        {
          ready: false,
          nextAction: "provide_valid_artifact",
          reason: "ARTIFACT_SHA256_MISMATCH",
          expectedSha256,
          actualSha256,
          sha256Source,
          downloaded: true,
          installed: false,
          launched: false,
          artifact: summarizeArtifact(artifact),
        },
        1,
      );
      return;
    }
  }

  if (flags.downloadOnly) {
    writeJson({
      ready: false,
      nextAction: "install_downloaded_artifact",
      reason: "INSTALLER_DOWNLOADED",
      downloaded: true,
      installed: false,
      launched: false,
      artifact: {
        ...summarizeArtifact(artifact),
        sha256Verified: Boolean(expectedSha256),
        sha256Source,
        installerPath: DEBUG_DISCOVERY ? download.path : null,
        installerPathPresent: true,
      },
      message:
        "The installer was downloaded after explicit confirmation. Re-run without --download-only to install with the default installer path.",
    });
    return;
  }

  const installResult = await installDownloadedArtifact(download.path, {
    interactive: flags.launch,
  });

  if (!installResult.supported) {
    writeJson(
      {
        ready: false,
        nextAction: "launch_installer_or_install_manually",
        reason: installResult.reason,
        message: installResult.message,
        downloaded: true,
        installed: false,
        launched: false,
        installer: summarizeInstallerResult(installResult),
        artifact: {
          ...summarizeArtifact(artifact),
          sha256Verified: Boolean(expectedSha256),
          sha256Source,
          installerPath: DEBUG_DISCOVERY ? download.path : null,
          installerPathPresent: true,
        },
      },
      1,
    );
    return;
  }

  if (
    (installResult.exitCode !== null &&
      !isSuccessfulInstallExitCode(installResult.exitCode)) ||
    installResult.signal
  ) {
    writeJson(
      {
        ready: false,
        nextAction: "retry_install_openloomi",
        reason: "AUTOMATIC_INSTALL_FAILED",
        message:
          "The OpenLoomi installer exited with a non-zero status while using the default install path.",
        downloaded: true,
        installed: false,
        launched: installResult.launched,
        installer: summarizeInstallerResult(installResult),
        artifact: {
          ...summarizeArtifact(artifact),
          sha256Verified: Boolean(expectedSha256),
          sha256Source,
          installerPath: DEBUG_DISCOVERY ? download.path : null,
          installerPathPresent: true,
        },
      },
      1,
    );
    return;
  }

  const postInstallStatus = installResult.requiresUserCompletion
    ? null
    : await buildSetupStatus();
  const installed = postInstallStatus ? postInstallStatus.installed : false;
  const ready = postInstallStatus ? postInstallStatus.ready : false;
  const nextAction = postInstallStatus
    ? postInstallStatus.nextAction
    : "complete_installer_then_rerun_setup_status";
  const reason = postInstallStatus
    ? postInstallStatus.installed
      ? "INSTALL_COMPLETE"
      : "INSTALL_EXITED_BUT_NOT_DISCOVERED"
    : "INSTALLER_LAUNCHED";

  writeJson({
    ready,
    nextAction,
    reason,
    downloaded: true,
    installed,
    launched: installResult.launched,
    installer: summarizeInstallerResult(installResult),
    postInstallStatus: postInstallStatus
      ? {
          installed: postInstallStatus.installed,
          ready: postInstallStatus.ready,
          nextAction: postInstallStatus.nextAction,
          reason: postInstallStatus.reason,
        }
      : null,
    artifact: {
      ...summarizeArtifact(artifact),
      sha256Verified: Boolean(expectedSha256),
      sha256Source,
      installerPath: DEBUG_DISCOVERY ? download.path : null,
      installerPathPresent: true,
    },
    message: installResult.requiresUserCompletion
      ? "The installer was launched after explicit confirmation. Complete the installer UI, then re-run setup-status."
      : "The installer completed using the default install path. Continue with the reported nextAction.",
  });
}

async function configureAiProvider(args) {
  const secretViolation = getSecretArgViolation(args);

  if (secretViolation) {
    writeJson(
      {
        ready: false,
        nextAction: "open_openloomi_ai_provider_setup",
        reason: "SECRET_INPUT_NOT_ALLOWED",
        rejectedFlag: secretViolation.flag,
        message:
          "API keys, OAuth tokens, and other secrets must not be passed through Codex chat or command-line arguments. Use an OpenLoomi-owned setup UI or CLI surface instead.",
      },
      1,
    );
    return;
  }

  const flags = parseFlags(args);
  const aiProvider = await getAiProviderStatus(getTokenStatus());
  const codexOAuth = getCodexOAuthFeasibility();
  const setupRequest = getAiProviderSetupRequest(flags);

  writeJson({
    ready: aiProvider.configured,
    nextAction: aiProvider.configured
      ? "setup_status"
      : "open_openloomi_ai_provider_setup",
    reason: aiProvider.configured
      ? "AI_PROVIDER_CONFIGURED"
      : "AI_PROVIDER_REQUIRED",
    aiProviderConfigured: aiProvider.configured,
    aiProviderStatus: aiProvider.status,
    checks: {
      aiProvider: aiProvider.checked,
      aiProviderRuntime: aiProvider.runtime,
    },
    codexOAuth,
    setupRequest,
    setupOptions: getAiProviderSetupOptions(codexOAuth),
    safety:
      "Only non-secret provider preferences may pass through Codex. API key entry must happen in OpenLoomi-owned UI or CLI surfaces.",
  });
}

function workflowGuidance(args) {
  const flags = parseFlags(args);
  const workflowId = getRequestedWorkflow(args, flags);
  const workflow = workflowId ? findWorkflowGuidance(workflowId) : null;

  if (workflowId && !workflow) {
    writeJson(
      {
        ready: false,
        nextAction: "choose_supported_workflow",
        reason: "UNKNOWN_WORKFLOW",
        requestedWorkflow: workflowId,
        supportedWorkflows: WORKFLOW_GUIDANCE.map(summarizeWorkflowGuidance),
      },
      1,
    );
    return;
  }

  if (!workflow) {
    writeJson({
      ready: true,
      nextAction: "choose_workflow",
      reason: "WORKFLOW_GUIDANCE_AVAILABLE",
      workflows: WORKFLOW_GUIDANCE.map(summarizeWorkflowGuidance),
      safety:
        "These are thin Codex plugin entrypoints. Runtime logic, memory, connectors, handoff persistence, and secrets stay inside OpenLoomi.",
    });
    return;
  }

  writeJson({
    ready: true,
    nextAction: workflow.readyRequired ? "check_setup_status" : "use_guidance",
    reason: "WORKFLOW_GUIDANCE_AVAILABLE",
    workflow: {
      ...workflow,
      readinessCheckCommand: "setup-status",
      runCommand:
        workflow.bridgeCommand === "run"
          ? 'printf "%s" "<task>" | loomi-bridge run'
          : workflow.bridgeCommand,
    },
  });
}

function getRequestedWorkflow(args, flags) {
  if (hasValue(flags.workflow)) {
    return flags.workflow;
  }

  return args.find((arg) => !arg.startsWith("--") && hasValue(arg)) || null;
}

function findWorkflowGuidance(value) {
  const normalized = normalizeWorkflowId(value);

  return WORKFLOW_GUIDANCE.find(
    (workflow) =>
      workflow.id === normalized ||
      workflow.aliases.some(
        (alias) => normalizeWorkflowId(alias) === normalized,
      ),
  );
}

function summarizeWorkflowGuidance(workflow) {
  return {
    id: workflow.id,
    title: workflow.title,
    description: workflow.description,
    wrapperSkill: workflow.wrapperSkill,
    readyRequired: workflow.readyRequired,
    bridgeCommand: workflow.bridgeCommand,
  };
}

function normalizeWorkflowId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

function getInstallPlan() {
  return {
    platform: process.platform,
    arch: process.arch,
    supported: ["darwin", "linux", "win32"].includes(process.platform),
    officialReleasePage: OFFICIAL_RELEASE_SOURCE.releasePage,
    officialReleaseApi: OFFICIAL_RELEASE_SOURCE.latestReleaseApi,
    artifactResolution:
      "The bridge resolves the latest official GitHub release asset for the current platform and architecture.",
    requiredUserAction:
      "Review the install plan, then re-run install-openloomi with --confirm. Passing --artifact-url is optional and only accepted for allowlisted official sources.",
    safety: [
      "The plugin never downloads or installs OpenLoomi without --confirm.",
      "On Windows, supported installers run silently with the default installer path.",
      "Use --download-only to resolve and download without installing.",
      "Use --launch to start the interactive installer UI instead of the default automatic install path.",
      "The plugin verifies GitHub release SHA-256 digest metadata when available.",
      "Use --sha256 to require a specific official checksum.",
      "Local installer paths are hidden unless OPENLOOMI_DEBUG_DISCOVERY=1 is set.",
    ],
  };
}

function parseFlags(args) {
  const flags = {
    artifactUrl: null,
    baseUrl: null,
    confirm: false,
    downloadOnly: false,
    launch: false,
    model: null,
    permissionMode: null,
    provider: null,
    sha256: null,
    workflow: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--confirm") {
      flags.confirm = true;
      continue;
    }

    if (arg === "--launch") {
      flags.launch = true;
      continue;
    }

    if (arg === "--download-only") {
      flags.downloadOnly = true;
      continue;
    }

    if (arg === "--provider") {
      flags.provider = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--provider=")) {
      flags.provider = arg.slice("--provider=".length);
      continue;
    }

    if (arg === "--base-url") {
      flags.baseUrl = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--base-url=")) {
      flags.baseUrl = arg.slice("--base-url=".length);
      continue;
    }

    if (arg === "--model") {
      flags.model = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--model=")) {
      flags.model = arg.slice("--model=".length);
      continue;
    }

    if (arg === "--permission-mode") {
      flags.permissionMode = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--permission-mode=")) {
      flags.permissionMode = arg.slice("--permission-mode=".length);
      continue;
    }

    if (arg === "--artifact-url") {
      flags.artifactUrl = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--artifact-url=")) {
      flags.artifactUrl = arg.slice("--artifact-url=".length);
      continue;
    }

    if (arg === "--sha256") {
      flags.sha256 = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--sha256=")) {
      flags.sha256 = arg.slice("--sha256=".length);
      continue;
    }

    if (arg === "--workflow") {
      flags.workflow = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--workflow=")) {
      flags.workflow = arg.slice("--workflow=".length);
    }
  }

  return flags;
}

function getSecretArgViolation(args) {
  const secretFlags = [
    "--api-key",
    "--apikey",
    "--auth-token",
    "--oauth-token",
    "--refresh-token",
    "--secret",
    "--token",
  ];

  for (const arg of args) {
    const normalized = arg.toLowerCase();
    const flag = secretFlags.find(
      (candidate) =>
        normalized === candidate || normalized.startsWith(`${candidate}=`),
    );

    if (flag) {
      return {
        flag,
      };
    }
  }

  return null;
}

function getCodexOAuthFeasibility() {
  const markedSupported = process.env.OPENLOOMI_CODEX_OAUTH_SUPPORTED === "1";

  return {
    available: markedSupported,
    source: markedSupported
      ? "OPENLOOMI_CODEX_OAUTH_SUPPORTED"
      : "not-configured",
    reason: markedSupported
      ? "OFFICIAL_CODEX_OAUTH_SURFACE_MARKED_AVAILABLE"
      : "NO_OFFICIAL_CODEX_OAUTH_SURFACE_VERIFIED",
    note: "Codex OAuth should only be used after an official supported surface is verified.",
  };
}

function getAiProviderSetupRequest(flags) {
  return {
    provider: sanitizePreference(flags.provider),
    baseUrl: sanitizePreference(flags.baseUrl),
    model: sanitizePreference(flags.model),
    apiKeyProvided: false,
    secretInputAccepted: false,
  };
}

function getAiProviderSetupOptions(codexOAuth) {
  return [
    {
      id: "codex_oauth",
      available: codexOAuth.available,
      ownedBy: "Codex/OpenLoomi",
      collectsSecrets: false,
      reason: codexOAuth.reason,
    },
    {
      id: "openloomi_desktop_settings",
      available: true,
      ownedBy: "OpenLoomi",
      collectsSecrets: true,
      action:
        "Open OpenLoomi Desktop settings and configure provider base URL, API key, and model name there.",
    },
    {
      id: "openloomi_cli_interactive",
      available: true,
      ownedBy: "OpenLoomi",
      collectsSecrets: true,
      action:
        "Use an OpenLoomi-owned interactive CLI setup surface when openloomi-ctl exposes one.",
    },
  ];
}

function sanitizePreference(value) {
  if (!hasValue(value)) {
    return null;
  }

  return value.trim().slice(0, 256);
}

function validateArtifactUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    return {
      valid: false,
      reason: "Artifact URL is not a valid URL.",
    };
  }

  if (url.protocol !== "https:") {
    return {
      valid: false,
      reason: "Artifact URL must use HTTPS.",
    };
  }

  if (!getAllowedArtifactHosts().includes(url.hostname)) {
    return {
      valid: false,
      reason: "Artifact URL host is not in the official OpenLoomi allowlist.",
    };
  }

  if (
    url.hostname === "github.com" &&
    !url.pathname
      .toLowerCase()
      .startsWith(
        `/${OFFICIAL_RELEASE_SOURCE.owner}/${OFFICIAL_RELEASE_SOURCE.repo}/`,
      )
  ) {
    return {
      valid: false,
      reason: `GitHub artifact URLs must come from the ${OFFICIAL_RELEASE_SOURCE.owner}/${OFFICIAL_RELEASE_SOURCE.repo} repository.`,
    };
  }

  return {
    valid: true,
    url,
  };
}

function getAllowedArtifactHosts() {
  return ["github.com", "openloomi.ai", "www.openloomi.ai"];
}

function getManualInstallerArtifact(value) {
  const artifact = validateArtifactUrl(value);

  if (!artifact.valid) {
    throw new BridgeError("ARTIFACT_URL_NOT_ALLOWED", artifact.reason, {
      allowedHosts: getAllowedArtifactHosts(),
      officialRepository: `${OFFICIAL_RELEASE_SOURCE.owner}/${OFFICIAL_RELEASE_SOURCE.repo}`,
    });
  }

  return {
    url: artifact.url,
    source: "manual-official-url",
    name: getInstallerFilename(artifact.url),
    size: null,
    sha256: null,
    releaseTag: null,
    releaseUrl: null,
  };
}

async function resolveOfficialInstallerArtifact() {
  const release = await fetchJson(
    new URL(OFFICIAL_RELEASE_SOURCE.latestReleaseApi),
  );
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = selectInstallerAsset(assets);

  if (!asset) {
    throw new BridgeError(
      "ARTIFACT_RESOLUTION_FAILED",
      `No supported OpenLoomi installer asset was found for ${process.platform}/${process.arch} in the latest official release.`,
      {
        platform: process.platform,
        arch: process.arch,
        releaseTag: release.tag_name || null,
        releaseUrl: release.html_url || OFFICIAL_RELEASE_SOURCE.releasePage,
      },
    );
  }

  const artifact = validateArtifactUrl(asset.browser_download_url);

  if (!artifact.valid) {
    throw new BridgeError("ARTIFACT_RESOLUTION_FAILED", artifact.reason, {
      releaseTag: release.tag_name || null,
      releaseUrl: release.html_url || OFFICIAL_RELEASE_SOURCE.releasePage,
    });
  }

  return {
    url: artifact.url,
    source: "github-release-latest",
    name: asset.name || getInstallerFilename(artifact.url),
    size: Number.isSafeInteger(asset.size) ? asset.size : null,
    sha256: normalizeSha256(asset.digest),
    releaseTag: release.tag_name || null,
    releaseUrl: release.html_url || OFFICIAL_RELEASE_SOURCE.releasePage,
  };
}

function selectInstallerAsset(assets) {
  const preferences = getInstallerAssetPreferences();
  const downloadAssets = assets.filter(
    (asset) => asset && typeof asset.browser_download_url === "string",
  );

  for (const preference of preferences) {
    const candidates = downloadAssets
      .filter((asset) => assetMatchesPreference(asset, preference))
      .sort((left, right) => (right.size || 0) - (left.size || 0));

    if (candidates.length > 0) {
      return candidates[0];
    }
  }

  for (const preference of preferences) {
    const candidates = downloadAssets
      .filter((asset) => assetMatchesExtension(asset, preference))
      .sort((left, right) => (right.size || 0) - (left.size || 0));

    if (candidates.length === 1) {
      return candidates[0];
    }
  }

  return null;
}

function getInstallerAssetPreferences() {
  const x64Tokens = ["x64", "x86_64", "amd64"];
  const arm64Tokens = ["arm64", "aarch64"];

  if (process.platform === "win32" && process.arch === "x64") {
    return [
      { extensions: [".exe"], archTokens: x64Tokens },
      { extensions: [".msi"], archTokens: x64Tokens },
    ];
  }

  if (process.platform === "win32" && process.arch === "arm64") {
    return [
      { extensions: [".exe"], archTokens: arm64Tokens },
      { extensions: [".msi"], archTokens: arm64Tokens },
    ];
  }

  if (process.platform === "darwin" && process.arch === "arm64") {
    return [{ extensions: [".dmg"], archTokens: arm64Tokens }];
  }

  if (process.platform === "darwin" && process.arch === "x64") {
    return [{ extensions: [".dmg"], archTokens: x64Tokens }];
  }

  if (process.platform === "linux" && process.arch === "arm64") {
    return [
      { extensions: [".deb"], archTokens: arm64Tokens },
      { extensions: [".rpm"], archTokens: arm64Tokens },
      { extensions: [".appimage"], archTokens: arm64Tokens },
    ];
  }

  if (process.platform === "linux" && process.arch === "x64") {
    return [
      { extensions: [".deb"], archTokens: x64Tokens },
      { extensions: [".rpm"], archTokens: x64Tokens },
      { extensions: [".appimage"], archTokens: x64Tokens },
    ];
  }

  return [];
}

function assetMatchesPreference(asset, preference) {
  const matchText = getAssetMatchText(asset);

  return (
    assetMatchesExtension(asset, preference) &&
    preference.archTokens.some((token) =>
      matchText.includes(token.toLowerCase()),
    )
  );
}

function assetMatchesExtension(asset, preference) {
  const matchText = getAssetMatchText(asset);

  if (
    matchText.includes(".blockmap") ||
    matchText.includes(".sig") ||
    matchText.includes(".sha")
  ) {
    return false;
  }

  return preference.extensions.some((extension) =>
    matchText.includes(extension.toLowerCase()),
  );
}

function getAssetMatchText(asset) {
  const name = String(asset.name || "");
  const url = String(asset.browser_download_url || "");

  return `${name} ${url}`.toLowerCase();
}

async function fetchJson(url, redirectCount = 0) {
  const text = await fetchText(url, {
    accept: "application/vnd.github+json",
    redirectCount,
    reason: "ARTIFACT_RESOLUTION_FAILED",
    timeoutMs: RELEASE_LOOKUP_TIMEOUT_MS,
  });

  try {
    return JSON.parse(text);
  } catch {
    throw new BridgeError(
      "ARTIFACT_RESOLUTION_FAILED",
      "The official OpenLoomi release response was not valid JSON.",
      {
        officialReleaseApi: OFFICIAL_RELEASE_SOURCE.latestReleaseApi,
      },
    );
  }
}

function fetchText(url, options) {
  return new Promise((resolve, reject) => {
    if (options.redirectCount > 5) {
      reject(
        new BridgeError(
          options.reason,
          "Too many redirects while resolving the official OpenLoomi release.",
        ),
      );
      return;
    }

    const request = https.get(
      url,
      {
        headers: {
          Accept: options.accept,
          "Accept-Encoding": "identity",
          "User-Agent": "Codex-OpenLoomi-Install",
        },
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const location = response.headers.location;

        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume();
          fetchText(new URL(location, url), {
            ...options,
            redirectCount: options.redirectCount + 1,
          })
            .then(resolve)
            .catch(reject);
          return;
        }

        if (statusCode !== 200) {
          response.resume();
          reject(
            new BridgeError(
              options.reason,
              `Official OpenLoomi release lookup failed with HTTP ${statusCode}.`,
              {
                officialReleaseApi: OFFICIAL_RELEASE_SOURCE.latestReleaseApi,
              },
            ),
          );
          return;
        }

        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;

          if (body.length > 2_000_000) {
            request.destroy();
            reject(
              new BridgeError(
                options.reason,
                "Official OpenLoomi release lookup returned an unexpectedly large response.",
              ),
            );
          }
        });
        response.on("end", () => resolve(body));
        response.on("error", reject);
      },
    );

    request.setTimeout(options.timeoutMs, () => {
      request.destroy();
      reject(
        new BridgeError(
          options.reason,
          "Timed out while resolving the official OpenLoomi release.",
          {
            timeoutMs: options.timeoutMs,
          },
        ),
      );
    });
    request.on("error", reject);
  });
}

async function downloadInstallerArtifact(artifact) {
  const downloadDir = path.join(os.tmpdir(), "openloomi-codex-plugin");
  const destination = path.join(
    downloadDir,
    getInstallerFilename(artifact.url, artifact.name),
  );
  const partialDestination = `${destination}.partial`;

  mkdirSync(downloadDir, {
    recursive: true,
  });

  safeUnlink(partialDestination);

  try {
    const download = await downloadUrl(artifact.url, partialDestination, {
      expectedSize: artifact.size,
    });

    renameSync(partialDestination, destination);

    return {
      path: destination,
      bytes: download.bytes,
    };
  } catch (error) {
    safeUnlink(partialDestination);
    throw error;
  }
}

function getInstallerFilename(url, suggestedName = null) {
  const parsedPath = decodeURIComponent(url.pathname || "");
  const basename = suggestedName || path.basename(parsedPath);
  const fallbackName = `openloomi-installer-${Date.now()}${getInstallerExtension()}`;
  const filename = basename && basename !== "/" ? basename : fallbackName;

  return filename.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function getInstallerExtension() {
  if (process.platform === "win32") {
    return ".exe";
  }

  if (process.platform === "darwin") {
    return ".dmg";
  }

  return ".AppImage";
}

function downloadUrl(url, destination, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(
        new BridgeError(
          "DOWNLOAD_FAILED",
          "Too many redirects while downloading the OpenLoomi installer.",
        ),
      );
      return;
    }

    let settled = false;
    let file = null;
    let receivedBytes = 0;
    let overallTimer = null;
    let stallTimer = null;

    const finish = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(overallTimer);
      clearTimeout(stallTimer);
      callback(value);
    };

    const fail = (error) => {
      if (file) {
        file.destroy();
      }

      finish(reject, error);
    };

    const resetStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        request.destroy();
        fail(
          new BridgeError(
            "DOWNLOAD_STALLED",
            "The OpenLoomi installer download stopped receiving data.",
            {
              stallTimeoutMs: DOWNLOAD_STALL_TIMEOUT_MS,
            },
          ),
        );
      }, DOWNLOAD_STALL_TIMEOUT_MS);
    };

    const request = https.get(
      url,
      {
        headers: {
          Accept: "application/octet-stream",
          "Accept-Encoding": "identity",
          "User-Agent": "Codex-OpenLoomi-Install",
        },
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const location = response.headers.location;

        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume();
          clearTimeout(overallTimer);
          clearTimeout(stallTimer);
          downloadUrl(
            new URL(location, url),
            destination,
            options,
            redirectCount + 1,
          )
            .then(resolve)
            .catch(reject);
          return;
        }

        if (statusCode !== 200) {
          response.resume();
          fail(
            new BridgeError(
              "DOWNLOAD_FAILED",
              `OpenLoomi installer download failed with HTTP ${statusCode}.`,
            ),
          );
          return;
        }

        resetStallTimer();

        file = createWriteStream(destination, {
          flags: "w",
        });

        response.on("data", (chunk) => {
          receivedBytes += chunk.length;
          resetStallTimer();
        });
        response.on("error", fail);
        response.pipe(file);
        file.on("finish", () => {
          file.close(() => {
            if (
              Number.isSafeInteger(options.expectedSize) &&
              receivedBytes !== options.expectedSize
            ) {
              fail(
                new BridgeError(
                  "DOWNLOAD_SIZE_MISMATCH",
                  "The downloaded OpenLoomi installer size did not match the official release metadata.",
                  {
                    expectedBytes: options.expectedSize,
                    actualBytes: receivedBytes,
                  },
                ),
              );
              return;
            }

            finish(resolve, {
              bytes: receivedBytes,
            });
          });
        });
        file.on("error", fail);
      },
    );

    overallTimer = setTimeout(() => {
      request.destroy();
      fail(
        new BridgeError(
          "DOWNLOAD_TIMED_OUT",
          "Timed out while downloading the OpenLoomi installer.",
          {
            timeoutMs: INSTALL_DOWNLOAD_TIMEOUT_MS,
          },
        ),
      );
    }, INSTALL_DOWNLOAD_TIMEOUT_MS);

    request.setTimeout(DOWNLOAD_STALL_TIMEOUT_MS, () => {
      request.destroy();
      fail(
        new BridgeError(
          "DOWNLOAD_STALLED",
          "The OpenLoomi installer download connection was inactive.",
          {
            stallTimeoutMs: DOWNLOAD_STALL_TIMEOUT_MS,
          },
        ),
      );
    });
    request.on("error", fail);
  });
}

function normalizeBridgeError(error, fallbackReason) {
  if (error instanceof BridgeError) {
    return {
      reason: error.reason,
      message: error.message,
      details: error.details,
    };
  }

  return {
    reason: fallbackReason,
    message: error instanceof Error ? error.message : String(error),
    details: {},
  };
}

function summarizeArtifact(artifact) {
  return {
    url: artifact.url.toString(),
    source: artifact.source,
    name: artifact.name,
    size: artifact.size,
    sha256Present: Boolean(artifact.sha256),
    releaseTag: artifact.releaseTag,
    releaseUrl: artifact.releaseUrl,
  };
}

function normalizeSha256(value) {
  if (!hasValue(value)) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^sha256[:=\s]+/, "");

  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function safeUnlink(filePath) {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Best effort cleanup for temporary download files.
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
    stream.on("error", reject);
  });
}

function launchInstaller(filePath) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? filePath
        : "xdg-open";
  const args =
    process.platform === "darwin" || process.platform === "linux"
      ? [filePath]
      : [];
  const child = spawn(command, args, {
    detached: true,
    shell: process.platform === "win32",
    stdio: "ignore",
    windowsHide: false,
  });

  child.unref();
}

async function installDownloadedArtifact(filePath, options) {
  if (options.interactive) {
    launchInstaller(filePath);

    return {
      supported: true,
      automatic: false,
      launched: true,
      requiresUserCompletion: true,
      mode: "interactive-installer-ui",
      command: getInstallerCommandLabel(filePath),
      args: [],
      exitCode: null,
      signal: null,
      stdoutPresent: false,
      stderrPresent: false,
    };
  }

  const command = getDefaultInstallCommand(filePath);

  if (!command) {
    return {
      supported: false,
      automatic: false,
      launched: false,
      requiresUserCompletion: true,
      mode: "unsupported-default-install",
      reason: "AUTOMATIC_INSTALL_UNSUPPORTED",
      message: `Automatic default-path installation is not supported for ${process.platform} ${path.extname(filePath) || "artifacts"} yet. Re-run with --launch to open the installer UI, or install OpenLoomi manually from the downloaded official artifact.`,
      command: getInstallerCommandLabel(filePath),
      args: [],
      exitCode: null,
      signal: null,
      stdoutPresent: false,
      stderrPresent: false,
    };
  }

  const result = await runCommandWithInput(
    command.command,
    command.args,
    "",
    INSTALL_TIMEOUT_MS,
  );

  return {
    supported: true,
    automatic: true,
    launched: false,
    requiresUserCompletion: false,
    mode: command.mode,
    command: command.label,
    args: command.safeArgs,
    exitCode: result.exitCode,
    signal: result.signal,
    restartRequired: result.exitCode === 3010,
    stdoutPresent: hasValue(result.stdout),
    stderrPresent: hasValue(result.stderr),
  };
}

function getDefaultInstallCommand(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (process.platform !== "win32") {
    return null;
  }

  if (extension === ".exe") {
    return {
      mode: "windows-nsis-silent-default-path",
      command: filePath,
      args: ["/S"],
      label: "installer-exe",
      safeArgs: ["/S"],
    };
  }

  if (extension === ".msi") {
    return {
      mode: "windows-msi-silent-default-path",
      command: "msiexec.exe",
      args: ["/i", filePath, "/qn", "/norestart"],
      label: "msiexec.exe",
      safeArgs: ["/i", "<installer>", "/qn", "/norestart"],
    };
  }

  return null;
}

function summarizeInstallerResult(result) {
  return {
    supported: result.supported,
    automatic: result.automatic,
    launched: result.launched,
    requiresUserCompletion: result.requiresUserCompletion,
    mode: result.mode,
    command: result.command,
    args: result.args,
    exitCode: result.exitCode,
    signal: result.signal,
    restartRequired: Boolean(result.restartRequired),
    stdoutPresent: result.stdoutPresent,
    stderrPresent: result.stderrPresent,
  };
}

function isSuccessfulInstallExitCode(exitCode) {
  return exitCode === 0 || exitCode === 3010;
}

function getInstallerCommandLabel(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  return extension ? `installer${extension}` : "installer";
}

// Bridge-facing writable permission mode (`allow | ask | deny`). Translates
// `allow` to the CLI-facing `bypass` value before constructing the
// `openloomi-ctl` argv. Keeps `ask` and `deny` unchanged so the bridge's
// public contract stays stable while the CLI's canonical contract remains
// `bypass | ask | deny` (see apps/web/src-tauri/src/cli.rs). Unknown or
// omitted values fall back to `deny` so the default cannot escalate.
const BRIDGE_PERMISSION_MODES = new Set(["allow", "ask", "deny"]);
const BRIDGE_TO_CLI_PERMISSION_MODE = Object.freeze({
  allow: "bypass",
  ask: "ask",
  deny: "deny",
});

function getPermissionMode(value) {
  if (BRIDGE_PERMISSION_MODES.has(value)) {
    return BRIDGE_TO_CLI_PERMISSION_MODE[value];
  }

  return "deny";
}

function runOpenLoomiOneShot({ ctlPath, permissionMode, prompt }) {
  return runCommandWithInput(
    ctlPath,
    ["--one-shot", "--stdin", "--json", "--permission-mode", permissionMode],
    prompt,
    RUN_TIMEOUT_MS,
    {
      env: getOpenLoomiCtlChildEnv(),
    },
  );
}

function acquireRunLock() {
  const lockPath = getRunLockPath();
  const now = Date.now();
  const lock = {
    id: `${process.pid}-${now}-${Math.random().toString(36).slice(2)}`,
    pid: process.pid,
    startedAt: now,
    command: "run",
  };

  mkdirSync(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = readRunLock(lockPath);

    if (existing && !isRunLockStale(existing, now)) {
      return {
        acquired: false,
        lockPath,
        existing,
      };
    }

    if (existing) {
      removeRunLock(lockPath);
    }

    try {
      writeFileSync(lockPath, JSON.stringify(lock), {
        flag: "wx",
        mode: 0o600,
      });

      return {
        acquired: true,
        lockPath,
        lock,
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }
  }

  return {
    acquired: false,
    lockPath,
    existing: readRunLock(lockPath),
  };
}

function releaseRunLock(acquiredLock) {
  if (!acquiredLock?.acquired) {
    return;
  }

  const current = readRunLock(acquiredLock.lockPath);
  if (current?.id === acquiredLock.lock.id) {
    removeRunLock(acquiredLock.lockPath);
  }
}

function getRunLockPath() {
  return path.join(os.homedir(), ".openloomi", "codex-plugin-run.lock");
}

function readRunLock(lockPath) {
  if (!isFile(lockPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileText(lockPath));
  } catch {
    return {
      id: "unreadable",
      startedAt: 0,
      command: "run",
    };
  }
}

function isRunLockStale(lock, now = Date.now()) {
  const startedAt = Number(lock?.startedAt || 0);
  return !startedAt || now - startedAt > getRunLockTtlMs();
}

function getRunLockTtlMs() {
  const configured = Number(process.env.OPENLOOMI_CODEX_BRIDGE_RUN_LOCK_TTL_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : RUN_LOCK_TTL_MS;
}

function removeRunLock(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function summarizeRunLock(lock) {
  if (!lock) {
    return null;
  }

  const startedAt = Number(lock.startedAt || 0);
  return {
    pid: Number(lock.pid || 0) || null,
    command: lock.command || "run",
    ageMs: startedAt ? Math.max(0, Date.now() - startedAt) : null,
    stale: isRunLockStale(lock),
  };
}

function getOpenLoomiCtlChildEnv() {
  // Do not synthesize OPENLOOMI_API_URL from the readiness probe. In v0.7.9,
  // setting it selects the legacy HTTP compatibility path and bypasses the
  // packaged CLI's direct native-agent runner.
  //
  // An explicit caller-provided OPENLOOMI_API_URL is already inherited by the
  // child through process.env in runCommandWithInput.
  return {};
}

async function initializeSession() {
  let setup = await buildSetupStatus();

  if (!setup.installed) {
    writeJson(
      {
        ...setup,
        ready: false,
        nextAction: "install_openloomi",
        reason: "INSTALL_REQUIRED",
        message:
          "OpenLoomi must be installed before the plugin can initialize a guest/session token.",
      },
      1,
    );
    return;
  }

  const session = await ensureOpenLoomiSession();

  writeJson(
    {
      ready: session.ready,
      nextAction: session.ready ? "setup_status" : session.nextAction,
      reason: session.ready ? "SESSION_READY" : session.reason,
      message: session.message,
      session: session.session,
    },
    session.ready ? 0 : 1,
  );
}

async function ensureOpenLoomiSession() {
  const token = getTokenStatus();

  if (token.present) {
    return {
      ready: true,
      message: "OpenLoomi session token is already available.",
      session: {
        tokenPresent: true,
        initialized: false,
        source: token.checked.find((item) => item.present)?.source || "unknown",
      },
    };
  }

  const firstAttempt = await tryInitializeGuestSessionFromLocalApi();

  if (firstAttempt.ready) {
    return firstAttempt;
  }

  const discovery = await discoverOpenLoomi();
  const launch = launchOpenLoomiForSession(discovery.ctlPath);

  if (launch.launched) {
    const deadline = Date.now() + SESSION_BOOTSTRAP_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await sleep(SESSION_BOOTSTRAP_POLL_MS);

      const fileToken = getTokenStatus();
      if (fileToken.present) {
        return {
          ready: true,
          message:
            "OpenLoomi started and wrote a local guest/session token for Codex.",
          session: {
            tokenPresent: true,
            initialized: true,
            source: fileToken.checked.find((item) => item.present)?.source,
            launch,
          },
        };
      }

      const retry = await tryInitializeGuestSessionFromLocalApi();
      if (retry.ready) {
        return {
          ...retry,
          session: {
            ...retry.session,
            launch,
          },
        };
      }
    }
  }

  return {
    ready: false,
    nextAction: "open_openloomi",
    reason: "SESSION_INITIALIZATION_REQUIRED",
    message:
      "OpenLoomi is installed, but the plugin could not initialize a local guest/session token. Open OpenLoomi once so it can create a guest session, then retry from Codex.",
    session: {
      tokenPresent: false,
      guestSupported: true,
      attempts: firstAttempt.session?.attempts || [],
      launch,
    },
  };
}

async function tryInitializeGuestSessionFromLocalApi() {
  const attempts = [];

  for (const baseUrl of getLocalApiBaseUrls()) {
    const result = await requestGuestToken(baseUrl);
    attempts.push(summarizeSessionAttempt(result));

    if (result.token) {
      saveOpenLoomiToken(result.token);

      return {
        ready: true,
        message:
          "Initialized an OpenLoomi guest session through the local OpenLoomi API.",
        session: {
          tokenPresent: true,
          initialized: true,
          guest: true,
          source: "local-openloomi-api",
          baseUrl,
          attempts,
        },
      };
    }
  }

  return {
    ready: false,
    session: {
      tokenPresent: false,
      attempts,
    },
  };
}

async function requestGuestToken(baseUrl) {
  if (typeof fetch !== "function") {
    return {
      baseUrl,
      reason: "FETCH_UNAVAILABLE",
    };
  }

  // Prefer /api/remote-auth/guest first: this is the OpenLoomi runtime
  // endpoint that registers a brand-new guest account in the local DB
  // and returns a JSON bearer token in one round-trip. It mirrors the
  // Claude plugin's cmdGuestLogin behavior so that "guest login" means
  // the same thing across plugins. We only fall through to the legacy
  // cookie-based path below when this endpoint is genuinely unavailable
  // (HTTP 404 / network error before any response); transient HTTP
  // failures or empty payloads are reported but still fall through,
  // since the cookie path is the documented fallback for older builds.
  const remoteAuth = await requestRemoteAuthGuestToken(baseUrl);
  if (remoteAuth?.token) {
    return remoteAuth;
  }

  // Fallback: legacy cookie flow (POST /api/auth/guest -> Set-Cookie,
  // then GET /api/auth/token with that cookie). Preserved verbatim.
  const cookie = await requestGuestTokenViaCookie(baseUrl);
  if (cookie?.token) {
    return cookie;
  }

  // Neither path yielded a token. Surface the more informative failure:
  // if the remote-auth endpoint was reachable but rejected/errored, its
  // reason is more diagnostic than the cookie-side one.
  if (remoteAuth && remoteAuth.reason) {
    return remoteAuth;
  }
  return (
    cookie || {
      baseUrl,
      reason: "API_UNREACHABLE",
    }
  );
}

// POST /api/remote-auth/guest -> { token, user? } bearer flow.
// Returns { baseUrl, status, reason, token?, path? }.
async function requestRemoteAuthGuestToken(baseUrl) {
  try {
    const res = await fetchWithTimeout(
      `${baseUrl}/api/remote-auth/guest`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({}),
      },
      SESSION_API_TIMEOUT_MS,
    );

    if (res.status === 404) {
      // Endpoint simply not present on this OpenLoomi build -> let the
      // caller try the cookie fallback instead of failing outright.
      return {
        baseUrl,
        status: res.status,
        reason: "REMOTE_AUTH_GUEST_MISSING",
        path: "remote-auth-guest",
      };
    }

    const text = await res.text().catch(() => "");
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    if (!res.ok) {
      return {
        baseUrl,
        status: res.status,
        reason: `REMOTE_AUTH_GUEST_HTTP_${res.status}`,
        error: payload,
        path: "remote-auth-guest",
      };
    }

    const token =
      payload && typeof payload.token === "string" ? payload.token.trim() : "";
    if (!token) {
      return {
        baseUrl,
        status: res.status,
        reason: "REMOTE_AUTH_GUEST_NO_TOKEN",
        response: payload,
        path: "remote-auth-guest",
      };
    }

    return {
      baseUrl,
      status: res.status,
      token,
      reason: "REMOTE_AUTH_GUEST_OK",
      path: "remote-auth-guest",
    };
  } catch (error) {
    return {
      baseUrl,
      reason:
        error && error.name === "AbortError"
          ? "API_TIMEOUT"
          : "API_UNREACHABLE",
      path: "remote-auth-guest",
    };
  }
}

// Legacy cookie flow: POST /api/auth/guest -> Set-Cookie,
// then GET /api/auth token with that cookie. Behavior identical to the
// previous implementation of requestGuestToken; extracted verbatim so
// that the new dispatch above remains easy to read.
async function requestGuestTokenViaCookie(baseUrl) {
  try {
    const guestResponse = await fetchWithTimeout(
      `${baseUrl}/api/auth/guest?redirectUrl=/`,
      {
        method: "POST",
        redirect: "manual",
      },
      SESSION_API_TIMEOUT_MS,
    );
    const cookieHeader = toCookieHeader(
      getSetCookieHeaders(guestResponse.headers),
    );

    if (!cookieHeader) {
      return {
        baseUrl,
        status: guestResponse.status,
        reason: "SESSION_COOKIE_MISSING",
        path: "auth-guest-cookie",
      };
    }

    const tokenResponse = await fetchWithTimeout(
      `${baseUrl}/api/auth/token`,
      {
        headers: {
          Cookie: cookieHeader,
        },
        redirect: "manual",
      },
      SESSION_API_TIMEOUT_MS,
    );

    if (!tokenResponse.ok) {
      return {
        baseUrl,
        status: tokenResponse.status,
        reason: "TOKEN_REQUEST_FAILED",
        path: "auth-guest-cookie",
      };
    }

    const payload = await tokenResponse.json();

    if (!hasValue(payload?.token)) {
      return {
        baseUrl,
        status: tokenResponse.status,
        reason: "TOKEN_MISSING",
        path: "auth-guest-cookie",
      };
    }

    return {
      baseUrl,
      status: tokenResponse.status,
      token: payload.token,
      reason: "TOKEN_CREATED",
      path: "auth-guest-cookie",
    };
  } catch (error) {
    return {
      baseUrl,
      reason: error?.name === "AbortError" ? "API_TIMEOUT" : "API_UNREACHABLE",
      path: "auth-guest-cookie",
    };
  }
}

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const header = headers.get("set-cookie");
  return header ? splitSetCookieHeader(header) : [];
}

function splitSetCookieHeader(header) {
  return String(header)
    .split(/,(?=\s*[^;,\s]+=)/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function toCookieHeader(setCookieHeaders) {
  return setCookieHeaders
    .map((entry) => entry.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function summarizeSessionAttempt(result) {
  return {
    baseUrl: result.baseUrl,
    status: result.status || null,
    reason: result.reason,
    tokenCreated: Boolean(result.token),
  };
}

function getLocalApiBaseUrls() {
  // Resolve API URLs in priority order:
  //   1. OPENLOOMI_API_URL - explicit override (canonical)
  //   2. OPENLOOMI_BASE_URL - same explicit override, used by
  //      `apiGET/apiPOST/apiPUT` and by the integration tests'
  //      `withFakeHome` helper.
  //   3. Loopback defaults (3414 / 3515) as a last-resort discovery aid
  //      for callers that didn't pin anything.
  //
  // When an explicit URL is set (1 or 2), we use ONLY that URL. This
  // matches the test contract: callers that pin a closed port
  // (e.g. http://127.0.0.1:1) expect "unreachable" to be reported,
  // not "reachable because some Next.js dev server happens to be
  // answering 429s on localhost:3414".
  const apiUrl = normalizeLocalApiUrl(process.env.OPENLOOMI_API_URL);
  if (apiUrl) return [apiUrl];
  const baseUrl = normalizeLocalApiUrl(process.env.OPENLOOMI_BASE_URL);
  if (baseUrl) return [baseUrl];

  return unique([
    "http://localhost:3414",
    "http://127.0.0.1:3414",
    "http://localhost:3515",
    "http://127.0.0.1:3515",
  ]);
}

async function probeLocalApi() {
  const attempts = [];

  if (typeof fetch !== "function") {
    return {
      reachableUrl: null,
      attempts: getLocalApiBaseUrls().map((baseUrl) => ({
        baseUrl,
        reason: "FETCH_UNAVAILABLE",
      })),
    };
  }

  for (const baseUrl of getLocalApiBaseUrls()) {
    const result = await probeLocalApiUrl(baseUrl);
    attempts.push(result);

    if (result.reachable) {
      return {
        reachableUrl: baseUrl,
        attempts,
      };
    }
  }

  return {
    reachableUrl: null,
    attempts,
  };
}

async function probeLocalApiUrl(baseUrl) {
  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/api/native/providers`,
      {
        method: "GET",
        redirect: "manual",
      },
      API_PROBE_TIMEOUT_MS,
    );

    return {
      baseUrl,
      status: response.status,
      reason: "HTTP_RESPONSE",
      reachable: true,
    };
  } catch (error) {
    return {
      baseUrl,
      reason: error?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
      reachable: false,
    };
  }
}

function normalizeLocalApiUrl(value) {
  if (!hasValue(value)) {
    return null;
  }

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

    if (!localHosts.has(host)) {
      return null;
    }

    url.pathname = "";
    url.search = "";
    url.hash = "";

    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function saveOpenLoomiToken(token) {
  const tokenPath = getOpenLoomiTokenPath();
  mkdirSync(path.dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, Buffer.from(token, "utf8").toString("base64"), {
    mode: 0o600,
  });
}

function launchOpenLoomiForSession(ctlPath) {
  const appPath = findOpenLoomiAppForCtl(ctlPath);

  if (!appPath) {
    return {
      launched: false,
      reason: "APP_EXECUTABLE_NOT_FOUND",
    };
  }

  try {
    const child = spawn(appPath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();

    return {
      launched: true,
      reason: "APP_LAUNCHED",
      ...debugPath("appPath", appPath),
    };
  } catch {
    return {
      launched: false,
      reason: "APP_LAUNCH_FAILED",
      ...debugPath("appPath", appPath),
    };
  }
}

// Walk up from a ctlPath looking for the enclosing `.app` bundle on
// macOS. ctlPath typically lives at
//   /Applications/OpenLoomi.app/Contents/Resources/cli/openloomi-ctl
// so we walk up parent directories until we find one whose name ends
// with `.app`. Returns null if no .app ancestor is found (e.g. a source
// checkout).
function findMacAppBundleForCtl(ctlPath) {
  if (!ctlPath) return null;
  let current = path.dirname(path.resolve(ctlPath));
  for (
    let index = 0;
    index < 8 && current && current !== path.dirname(current);
    index += 1
  ) {
    if (current.endsWith(".app") && isDirectory(current)) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}

// Programmatically launches the OpenLoomi desktop app so the local HTTP
// API comes up. This is what unblocks `waitForApi` and the auto-login
// step in the setup state machine. We do NOT touch the GUI (no
// AppleScript, no keystrokes); the app starts in its normal state and
// we just poll for the API.
//
// Per-platform:
//   macOS   -> `open -a <bundle>`
//   Linux   -> `gtk-launch <desktopId>` (best-effort), then direct spawn fallback
//   Windows -> `cmd /c start "" <exe>`
async function launchDesktopApp({ ctlPath, desktopMarker } = {}) {
  // Resolve launch target. On macOS, ctlPath typically lives at
  //   <Foo.app>/Contents/Resources/cli/openloomi-ctl
  // so we walk up to the .app boundary. The default helper
  // findOpenLoomiAppForCtl() only finds executables - it never returns
  // the .app bundle itself - so without this fallback we'd be stuck on
  // every installed macOS user.
  let appPath = desktopMarker || null;
  if (!appPath && process.platform === "darwin" && ctlPath) {
    appPath = findMacAppBundleForCtl(ctlPath);
  }
  if (!appPath) {
    appPath = findOpenLoomiAppForCtl(ctlPath);
  }

  if (!appPath) {
    return {
      ok: false,
      code: "NO_LAUNCH_TARGET",
      message: "No OpenLoomi app path or ctlPath to launch.",
    };
  }

  const platformName = process.platform;
  let cmd;
  let args;
  let via;

  if (platformName === "darwin") {
    cmd = "open";
    args = ["-a", appPath];
    via = "open -a";
  } else if (platformName === "win32") {
    cmd = "cmd";
    args = ["/c", "start", '""', appPath];
    via = "cmd /c start";
  } else {
    // Linux: try gtk-launch first (a .desktop file shipped by the app
    // bundle, if any), then fall back to spawning the binary directly.
    cmd = "gtk-launch";
    args = ["openloomi"];
    via = "gtk-launch openloomi";
  }

  return await new Promise((resolve) => {
    let stderr = "";
    let child;
    try {
      child = spawn(cmd, args, {
        stdio: ["ignore", "ignore", "pipe"],
        detached: true,
      });
      child.unref();
    } catch (e) {
      resolve({
        ok: false,
        code: "SPAWN_FAILED",
        via,
        message: e instanceof Error ? e.message : String(e),
        ...debugPath("appPath", appPath),
      });
      return;
    }

    child.stderr?.on("data", (b) => {
      stderr += b.toString("utf8");
    });

    // `open -a` returns synchronously after handing the bundle to
    // launchd, so we treat the lack of an immediate spawn error as
    // "launched" and let `waitForApi` confirm the API actually came up.
    resolve({
      ok: true,
      code: "LAUNCHED",
      via,
      ...debugPath("appPath", appPath),
      stderr: stderr.trim() || null,
    });
  });
}

// Polls the local OpenLoomi HTTP API until it answers 2xx/3xx/4xx (any
// real HTTP response - the route being 404 still means the daemon is up)
// or the deadline expires. Used by setup() after launching the desktop
// app to confirm the helper process laid down its listener.
async function waitForApi({ timeoutMs = 30_000, pollMs = 1000 } = {}) {
  const startedAt = Date.now();
  const urls = getLocalApiBaseUrls();
  const deadline = startedAt + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    for (const baseUrl of urls) {
      try {
        const res = await fetch(`${baseUrl}/api/health`, {
          signal: AbortSignal.timeout(1500),
        });
        // Any HTTP response means the daemon is listening. We don't
        // require a specific status - the runtime may not yet expose
        // /api/health on every build, so 404 here still counts.
        return {
          ok: true,
          baseUrl,
          status: res.status,
          elapsedMs: Date.now() - startedAt,
          url: `${baseUrl}/api/health`,
        };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    await sleep(pollMs);
  }

  return {
    ok: false,
    code: "API_NOT_READY",
    elapsedMs: Date.now() - startedAt,
    attempted: urls.map((u) => `${u}/api/health`),
    lastError,
  };
}

function findOpenLoomiAppForCtl(ctlPath) {
  const normalizedCtlPath = normalizePath(ctlPath);

  if (!normalizedCtlPath) {
    return null;
  }

  const dirs = [];
  let current = path.dirname(normalizedCtlPath);

  for (
    let index = 0;
    index < 6 && current && current !== path.dirname(current);
    index += 1
  ) {
    dirs.push(current);
    current = path.dirname(current);
  }

  const candidates = unique(
    dirs.flatMap((directory) =>
      getOpenLoomiAppNames().map((name) => path.join(directory, name)),
    ),
  );

  return candidates.find(isFile) || null;
}

function getOpenLoomiAppNames() {
  if (process.platform === "win32") {
    return ["openloomi.exe", "OpenLoomi.exe"];
  }

  if (process.platform === "darwin") {
    return ["openloomi", "OpenLoomi"];
  }

  return ["openloomi", "OpenLoomi", "openloomi.AppImage", "OpenLoomi.AppImage"];
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runCommandWithInput(command, args, input, timeoutMs, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
      windowsHide: true,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        signal: null,
        stdout,
        stderr: error.message,
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
      });
    });

    child.stdin.end(input);
  });
}

function normalizeRunFailure(result) {
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (output.includes("login") || output.includes("auth")) {
    return {
      nextAction: "initialize_openloomi_session",
      reason: "SESSION_INITIALIZATION_REQUIRED",
      message:
        "OpenLoomi needs a local guest or signed-in session token before one-shot execution. OpenLoomi guest sessions are supported; no registered login is required by the Codex plugin.",
      openloomi: summarizeRunProcess(result),
    };
  }

  if (
    output.includes("api key") ||
    output.includes("model provider") ||
    output.includes("ai provider")
  ) {
    return {
      nextAction: "configure_ai_provider",
      reason: "AI_PROVIDER_REQUIRED",
      openloomi: summarizeRunProcess(result),
    };
  }

  if (output.includes("connector") || output.includes("integration")) {
    return {
      nextAction: "configure_connectors",
      reason: "CONNECTOR_SETUP_REQUIRED",
      openloomi: summarizeRunProcess(result),
    };
  }

  return {
    nextAction: "inspect_openloomi_error",
    reason: "OPENLOOMI_RUN_FAILED",
    openloomi: summarizeRunProcess(result),
    error: parseJsonOrText(result.stderr || result.stdout),
  };
}

function summarizeRunProcess(result) {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    stdoutPresent: hasValue(result.stdout),
    stderrPresent: hasValue(result.stderr),
  };
}

function parseJsonOrText(value) {
  if (!hasValue(value)) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return {
      text: value.trim(),
    };
  }
}

function version() {
  writeJson({
    name: "openloomi-codex-bridge",
    version: BRIDGE_VERSION,
    pluginPhase: PLUGIN_PHASE,
    commands: Array.from(COMMANDS).sort(),
  });
}

async function postPetState(
  baseUrl,
  state,
  token,
  {
    source = "codex-plugin",
    event = null,
    timeoutMs = PET_HTTP_TIMEOUT_MS,
  } = {},
) {
  const body = { state, source };
  if (event) body.event = event;

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/api/pet/state`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      },
      timeoutMs,
    );

    const text = await response.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    const attempt = {
      baseUrl,
      status: response.status,
      reason: "HTTP_RESPONSE",
    };

    if (response.ok) {
      return { ok: true, response: json, attempt };
    }

    return {
      ok: false,
      code: response.status === 404 ? "ENDPOINT_MISSING" : "PET_FAILED",
      response: json,
      attempt,
    };
  } catch (error) {
    return {
      ok: false,
      code: "API_UNREACHABLE",
      message: error?.message || String(error),
      attempt: {
        baseUrl,
        reason: error?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
        message: error?.message || String(error),
      },
    };
  }
}

// -----------------------------------------------------------------------------
// codex-runtime-info
//
// Static guidance for switching the OpenLoomi desktop app's agent runtime
// from the default `claude` to the `codex` runtime (Codex CLI). Used by
// the Codex SKILL so it can detect a missing `OPENLOOMI_AGENT_PROVIDER`
// export before suggesting commands, and by humans running
// `loomi-bridge codex-runtime-info` to confirm what the server actually
// sees.
//
// The runtime resolution logic here intentionally mirrors
// `apps/web/lib/ai/native-agent/provider-env.ts`:
//   * empty, whitespace, or unsupported values resolve to "claude"
//   * normalized lower-case otherwise
// Anything else (e.g. unknown value) is surfaced verbatim so the caller
// can spot a typo.
// -----------------------------------------------------------------------------
const CODEX_RUNTIME_INFO_KEY = "OPENLOOMI_AGENT_PROVIDER";
const DEFAULT_RUNTIME_PROVIDER = "claude";
const CODEX_RUNTIME_PROVIDER = "codex";

const CODEX_RUNTIME_COMPANION_ENV_VARS = [
  {
    name: "OPENLOOMI_AGENT_CODEX_COMMAND",
    description: "Path to the Codex CLI binary (default: `codex` on PATH).",
  },
  {
    name: "OPENLOOMI_AGENT_CODEX_MODEL",
    description: "Model identifier, e.g. `gpt-5.4`.",
  },
  {
    name: "OPENLOOMI_AGENT_CODEX_PROFILE",
    description: "Passed to the CLI as `-p <name>`.",
  },
  {
    name: "OPENLOOMI_AGENT_CODEX_SANDBOX",
    description:
      "`read-only` | `workspace-write` | `danger-full-access` (default `workspace-write`; plan phase is always forced to `read-only`).",
  },
  {
    name: "OPENLOOMI_AGENT_CODEX_ASK_FOR_APPROVAL",
    description:
      "`untrusted` | `on-failure` | `on-request` | `never` (default `on-request`).",
  },
  {
    name: "OPENLOOMI_AGENT_CODEX_SKIP_GIT_REPO_CHECK",
    description: "Default `true`.",
  },
  {
    name: "OPENLOOMI_AGENT_CODEX_FULL_AUTO",
    description:
      "Set `true` to allow `--full-auto` only under `bypassPermissions`.",
  },
  {
    name: "OPENLOOMI_AGENT_CODEX_TIMEOUT_MS",
    description: "CLI runtime budget in milliseconds.",
  },
];

const CODEX_RUNTIME_PREREQUISITES = [
  "`which codex` resolves to a working Codex CLI binary (`brew install --cask codex` or `npm i -g @openai/codex`).",
  "`~/.codex/config.toml` is configured and `OPENAI_API_KEY` (or Codex CLI's other auth) is available to the spawned process.",
  "The desktop app's web server is reachable at the URL printed by the OpenLoomi launcher (default `http://localhost:3515`).",
];

function resolveCurrentDefaultProvider(env = process.env) {
  const raw = env[CODEX_RUNTIME_INFO_KEY];
  if (typeof raw !== "string") return DEFAULT_RUNTIME_PROVIDER;
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_RUNTIME_PROVIDER;
  return trimmed.toLowerCase();
}

function codexRuntimeInfo() {
  const currentDefaultProvider = resolveCurrentDefaultProvider();
  const platform = process.platform;

  // Per-platform snippets. The current-platform string is promoted to
  // the top-level `switch.oneOff` / `switch.permanent` fields so most
  // callers can copy-paste a single ready-to-run snippet. The full
  // breakdown stays available under `switch.perPlatform` for callers
  // that need to render a multi-platform table.
  const oneOffByPlatform = {
    darwin: [
      // `export OPENLOOMI_AGENT_PROVIDER=codex` reaches the shell but
      // not the GUI web server. `launchctl setenv` does. We print both
      // so a reader understands which one actually takes effect, and
      // so callers can grep for `OPENLOOMI_AGENT_PROVIDER=codex` to
      // confirm the env name + value pair is documented.
      "export OPENLOOMI_AGENT_PROVIDER=codex",
      "node plugins/codex/scripts/loomi-bridge.mjs set-codex-runtime-env codex --persist",
      "# then Quit + reopen OpenLoomi.app",
    ].join("\n"),
    linux: [
      "export OPENLOOMI_AGENT_PROVIDER=codex",
      "systemctl --user import-environment OPENLOOMI_AGENT_PROVIDER=codex",
      "( next desktop session reads it; restart OpenLoomi now )",
    ].join("\n"),
    win32: "setx OPENLOOMI_AGENT_PROVIDER codex  (then restart OpenLoomi)",
  };
  const permanentByPlatform = {
    darwin: [
      "echo 'export OPENLOOMI_AGENT_PROVIDER=codex' >> ~/.zshrc",
      "node plugins/codex/scripts/loomi-bridge.mjs set-codex-runtime-env codex --persist",
      "# (or) install a LaunchAgent plist manually that re-applies launchctl setenv on every login",
    ].join("\n"),
    linux: [
      "echo 'OPENLOOMI_AGENT_PROVIDER=codex' >> ~/.config/environment.d/openloomi-codex.conf",
    ].join("\n"),
    win32:
      "Add OPENLOOMI_AGENT_PROVIDER=codex to User environment variables via System Settings.",
  };

  writeJson({
    purpose:
      "Switch the OpenLoomi desktop app agent runtime from the built-in Claude runtime to the Codex CLI.",
    envProviderKey: CODEX_RUNTIME_INFO_KEY,
    platform,
    persistence: probePersistenceState(),
    switch: {
      // Current-platform snippets are kept as strings so most callers
      // can copy-paste directly. Field name is unchanged; type just
      // narrows from `object` to `string`.
      oneOff: oneOffByPlatform[platform] || oneOffByPlatform.darwin,
      permanent: permanentByPlatform[platform] || permanentByPlatform.darwin,
      perPlatform: {
        oneOff: oneOffByPlatform,
        permanent: permanentByPlatform,
      },
      notes:
        "macOS GUI apps inherit env from launchd - `export` in a terminal does NOT reach the OpenLoomi web server. Use `launchctl setenv OPENLOOMI_AGENT_PROVIDER codex` (handled by `set-codex-runtime-env`) and then Quit + reopen OpenLoomi.app so the new env is inherited by the freshly forked web process.",
    },
    prerequisites: CODEX_RUNTIME_PREREQUISITES,
    companionEnvVars: CODEX_RUNTIME_COMPANION_ENV_VARS,
    defaults: {
      currentDefaultProvider,
      isCodexActive: currentDefaultProvider === CODEX_RUNTIME_PROVIDER,
      resolvedValue: currentDefaultProvider,
      rawValue:
        typeof process.env[CODEX_RUNTIME_INFO_KEY] === "string"
          ? process.env[CODEX_RUNTIME_INFO_KEY]
          : null,
    },
    verify: {
      endpoint: "/api/native/providers",
      expectDefaultAgent: CODEX_RUNTIME_PROVIDER,
      expectAgentType: CODEX_RUNTIME_PROVIDER,
      instructions:
        'After launching the app, GET /api/native/providers should report `defaultAgent: "codex"` and include a `codex` entry in `agents`. If `defaultAgent` is still `"claude"`, the env var did not reach the web server.',
    },
    bridge: {
      name: "openloomi-codex-bridge",
      version: BRIDGE_VERSION,
    },
  });
}

// ---------------------------------------------------------------------------
// set-codex-runtime-env
//
// Persist `OPENLOOMI_AGENT_PROVIDER=<value>` into the host environment the
// OpenLoomi web server (Tauri-launched) will actually inherit, not just the
// shell that ran this command.
//
// Why this exists:
//   On macOS the desktop app's web server runs inside the GUI launchd
//   session, which does NOT inherit `export FOO=bar` from a terminal.
//   Setting it from a shell works for `openloomi-ctl` and the bridge but
//   `GET /api/native/providers` from the web server still reports
//   `defaultAgent: "claude"`, so the conversation setup CTA keeps asking
//   for an Anthropic-compatible provider. The fix is `launchctl setenv`
//   in the GUI domain followed by a Quit + reopen of OpenLoomi.app.
//
// Behavior:
//   - darwin: `launchctl setenv OPENLOOMI_AGENT_PROVIDER <value>` and
//     confirm with `launchctl getenv` after.
//   - linux: write to `~/.config/environment.d/openloomi-codex.conf`. The
//     desktop session must pick this up on next login; a running session
//     does not see the change unless the user re-logs in or runs
//     `systemctl --user import-environment OPENLOOMI_AGENT_PROVIDER=codex`.
//   - win32: emit the equivalent system-env instructions; the bridge
//     never modifies the Windows registry directly.
//
// Flags:
//   <value>      default "codex"
//   --unset      clear the variable instead of setting it
//   --dry-run    describe what would happen without doing it
// ---------------------------------------------------------------------------
const RUNTIME_ENV_KEY = "OPENLOOMI_AGENT_PROVIDER";
const LINUX_ENV_DIR = ".config/environment.d";
const LINUX_ENV_FILE = "openloomi-codex.conf";
const DARWIN_LAUNCH_AGENT_LABEL = "com.openloomi.codex-runtime-env";

// ~/Library/LaunchAgents/com.openloomi.codex-runtime-env.plist
function darwinLaunchAgentPath() {
  return path.join(
    expandHome("~"),
    "Library",
    "LaunchAgents",
    `${DARWIN_LAUNCH_AGENT_LABEL}.plist`,
  );
}

// Escape XML special chars. Plist values flow verbatim into <string> elements,
// so `&`, `<`, `>` must be encoded. Label is a constant; key/value are user-
// supplied so they go through escapePlistString.
function escapePlistString(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Pure function: build a hardened LaunchAgent plist XML body. RunAtLoad re-
// applies `launchctl setenv KEY VALUE` at every login so OPENLOOMI_AGENT_PROVIDER
// survives logout/reboot. LimitLoadToSessionType=Aqua keeps it in the GUI
// session. ProcessType=Background avoids foreground scheduling.
function buildLaunchAgentPlist({ label, key, value }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapePlistString(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/launchctl</string>
    <string>setenv</string>
    <string>${escapePlistString(key)}</string>
    <string>${escapePlistString(value)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
</dict>
</plist>
`;
}

function parseSetRuntimeEnvFlags(args) {
  const out = { value: "codex", unset: false, dryRun: false, persist: false };
  for (const arg of args) {
    if (arg === "--unset") out.unset = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--persist") out.persist = true;
    else if (!arg.startsWith("--") && out.value === "codex") out.value = arg;
  }
  return out;
}

function runCapture(command, args, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeoutMs);
    child.stdout.on("data", (c) => {
      stdout += c.toString("utf8");
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        error: error.message,
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr, error: null });
    });
  });
}

async function setCodexRuntimeEnv(args) {
  const flags = parseSetRuntimeEnvFlags(args || []);
  const key = RUNTIME_ENV_KEY;
  const value = flags.unset ? null : flags.value;

  // Read current GUI/host value to report before/after. We deliberately
  // use shell helpers rather than `import fs` because the bridge keeps
  // its dependency surface tight and a one-shot read is good enough.
  const beforeProbe = await probeRuntimeEnvValue(key);
  const beforeValue = beforeProbe.value;

  const plan = planRuntimeEnvChange({
    platform: process.platform,
    key,
    value,
    flags,
  });

  if (flags.dryRun) {
    return writeJson({
      ok: true,
      dryRun: true,
      platform: process.platform,
      key,
      value,
      before: beforeValue,
      actions: plan.actions,
      notes: plan.notes,
      requiresRestart: plan.requiresRestart,
      commands: plan.commands,
    });
  }

  const executed = [];
  for (const action of plan.actions) {
    const r = await runCapture(action.command, action.args);
    executed.push({
      command: [action.command, ...action.args].join(" "),
      exitCode: r.exitCode,
      stderr: (r.stderr || "").trim() || null,
    });
    if (r.exitCode !== 0) {
      return writeJson(
        {
          ok: false,
          platform: process.platform,
          key,
          value,
          before: beforeValue,
          error: {
            stage: action.label,
            exitCode: r.exitCode,
            stderr: (r.stderr || "").trim() || null,
          },
          actions: executed,
          notes: plan.notes,
          commands: plan.commands,
        },
        1,
      );
    }
  }

  // Re-read after the change so the caller can confirm it landed.
  const afterProbe = await probeRuntimeEnvValue(key);
  const afterValue = afterProbe.value;

  return writeJson({
    ok: true,
    platform: process.platform,
    key,
    value,
    before: beforeValue,
    after: afterValue,
    actions: executed,
    notes: plan.notes,
    requiresRestart: plan.requiresRestart,
    commands: plan.commands,
    manualSteps: plan.manualSteps || [],
  });
}

// Lightweight probe of the persistence mechanism for the current platform.
// Used by `codex-runtime-info` and `getCodexRuntimeEnvStatus` so callers can
// see whether OPENLOOMI_AGENT_PROVIDER will survive a logout/reboot even when
// the in-memory launchd value already matches.
//
// Returns a discriminated shape keyed by platform. Each platform reports:
//   - darwin: { launchAgentInstalled: boolean, launchAgentPath: string }
//   - linux:  { envFileInstalled: boolean, envFilePath: string }
//   - win32:  { manualStepsRequired: true }
//
// Platforms other than the host report `null` for installed flags to make
// "not applicable" distinguishable from "false" in downstream tests.
function probePersistenceState() {
  if (process.platform === "darwin") {
    const plistPath = darwinLaunchAgentPath();
    const installed = isFile(plistPath);
    return {
      darwin: { launchAgentInstalled: installed, launchAgentPath: plistPath },
      linux: { envFileInstalled: null, envFilePath: null },
      win32: { manualStepsRequired: true },
    };
  }
  if (process.platform === "linux") {
    const file = path.join(expandHome(`~/${LINUX_ENV_DIR}`), LINUX_ENV_FILE);
    return {
      darwin: { launchAgentInstalled: null, launchAgentPath: null },
      linux: { envFileInstalled: isFile(file), envFilePath: file },
      win32: { manualStepsRequired: true },
    };
  }
  return {
    darwin: { launchAgentInstalled: null, launchAgentPath: null },
    linux: { envFileInstalled: null, envFilePath: null },
    win32: { manualStepsRequired: true },
  };
}

async function probeRuntimeEnvValue(key) {
  if (process.platform === "darwin") {
    const r = await runCapture("launchctl", ["getenv", key]);
    if (r.exitCode === 0) {
      return { value: r.stdout.trim() || null, source: "launchd-gui" };
    }
    return { value: null, source: null };
  }
  if (process.platform === "linux") {
    const file = path.join(expandHome(`~/${LINUX_ENV_DIR}`), LINUX_ENV_FILE);
    const cat = await runCapture("/bin/sh", [
      "-c",
      `[ -f "${file}" ] && grep -E "^${key}=" "${file}" | head -n1 || true`,
    ]);
    const raw = (cat.stdout || "").trim();
    if (!raw) return { value: null, source: null };
    const eq = raw.indexOf("=");
    if (eq < 0) return { value: null, source: null };
    return {
      value: raw.slice(eq + 1).trim() || null,
      source: `${LINUX_ENV_DIR}/${LINUX_ENV_FILE}`,
    };
  }
  if (process.platform === "win32") {
    // `setx` writes to HKCU\Environment, but reading the live value
    // requires either `reg query` or `$Env:`. Bridge doesn't shell out
    // for it because the win32 path is dry-run/messages-only by design.
    return { value: process.env[key] || null, source: "process.env" };
  }
  return { value: null, source: null };
}

function planRuntimeEnvChange({ platform, key, value, flags }) {
  const actions = [];
  const commands = [];
  const notes = [];
  const requiresRestart = true;

  if (platform === "darwin") {
    const args = flags.unset ? ["unsetenv", key] : ["setenv", key, value];
    actions.push({
      label: flags.unset ? "launchctl unsetenv" : "launchctl setenv",
      command: "launchctl",
      args,
    });
    commands.push(
      `launchctl ${flags.unset ? "unsetenv" : "setenv"} ${key}${value ? " " + value : ""}`,
    );

    if (flags.persist) {
      const plistPath = darwinLaunchAgentPath();
      const plistDir = path.dirname(plistPath);
      const uid =
        typeof process.getuid === "function" ? process.getuid() : null;
      const guiTarget = uid != null ? `gui/${uid}` : "gui/$UID";

      if (flags.unset) {
        // Best-effort bootout: agent may not be loaded, exit code != 0 is OK.
        actions.push({
          label: "launchctl bootout (best-effort)",
          command: "launchctl",
          args: ["bootout", guiTarget, plistPath],
        });
        actions.push({ label: "rm plist", command: "rm", args: ["-f", plistPath] });
        commands.push(`launchctl bootout ${guiTarget} ${plistPath}  # best-effort`);
        commands.push(`rm -f ${plistPath}`);
        notes.push(
          `Removed LaunchAgent ${plistPath}. ${key} will no longer be re-applied on login.`,
        );
      } else {
        actions.push({
          label: "mkdir LaunchAgents",
          command: "/bin/mkdir",
          args: ["-p", plistDir],
        });
        actions.push({
          label: "write plist",
          command: "/bin/sh",
          args: [
            "-c",
            `cat > '${plistPath}' <<'__OPENLOOMI_CODEX_PLIST_EOF__'\n${buildLaunchAgentPlist({ label: DARWIN_LAUNCH_AGENT_LABEL, key, value })}__OPENLOOMI_CODEX_PLIST_EOF__`,
          ],
        });
        if (uid != null) {
          actions.push({
            label: "launchctl bootstrap",
            command: "launchctl",
            args: ["bootstrap", guiTarget, plistPath],
          });
          commands.push(`launchctl bootstrap ${guiTarget} ${plistPath}`);
        }
        commands.push(`mkdir -p ${plistDir}`);
        commands.push(
          `write ${plistPath} (RunAtLoad launchctl setenv ${key} ${value})`,
        );
        notes.push(
          `Installed LaunchAgent ${plistPath} so ${key}=${value} survives logout/reboot. Quit and reopen OpenLoomi.app for the new env to take effect in the running web server.`,
        );
      }
    } else {
      notes.push(
        flags.unset
          ? "Cleared OPENLOOMI_AGENT_PROVIDER from the GUI launchd domain (transient — lost on logout/reboot)."
          : "Set OPENLOOMI_AGENT_PROVIDER in the GUI launchd domain (transient — lost on logout/reboot; pass --persist to install a LaunchAgent plist).",
      );
    }

    return {
      actions,
      commands,
      notes,
      requiresRestart,
    };
  }

  if (platform === "linux") {
    const dir = `~/${LINUX_ENV_DIR}`;
    const file = path.join(expandHome(dir), LINUX_ENV_FILE);
    if (flags.unset) {
      actions.push({ label: "rm env file", command: "rm", args: ["-f", file] });
      commands.push(`rm -f ${dir}/${LINUX_ENV_FILE}`);
      notes.push(
        "Removed the per-user env file. A re-login is required for the desktop session to drop the variable.",
      );
      return { actions, commands, notes, requiresRestart };
    }
    actions.push({
      label: "write env file",
      command: "/bin/sh",
      args: [
        "-c",
        `mkdir -p '${dir}' && printf '%s\n' '${key}=${value}' > '${dir}/${LINUX_ENV_FILE}'`,
      ],
    });
    commands.push(
      `printf '%s\n' '${key}=${value}' >> ${dir}/${LINUX_ENV_FILE}`,
    );
    notes.push(
      "Wrote the per-user env file. Run `systemctl --user import-environment " +
        key +
        "` (or re-login) so the current desktop session picks it up.",
    );
    return { actions, commands, notes, requiresRestart };
  }

  if (platform === "win32") {
    notes.push(
      "Windows is not automated: edit the user environment via System Settings -> Environment Variables, then restart OpenLoomi.",
    );
    commands.push(`setx ${key} ${value || ""}`);
    return {
      actions,
      commands,
      notes,
      requiresRestart,
      manualSteps: [
        "Open System Settings -> System -> About -> Advanced system settings -> Environment Variables.",
        `Under "User variables", add (or update) ${key} with value ${value || "<empty for unset>"}.`,
        "Click OK, then Quit + reopen OpenLoomi.",
      ],
    };
  }

  notes.push(`Unsupported platform: ${platform}. Set ${key} manually.`);
  return { actions, commands, notes, requiresRestart };
}

// Run another bridge subcommand as a child process and capture the JSON it
// prints to stdout. Used by `setup` to chain install / session init without
// having to refactor the underlying writeJson() early-returns.
//
// The child runs with the same env as the parent, minus the few knobs that
// would change bridge behavior mid-setup. Secrets (api keys, auth tokens)
// are never read here; if the user pastes one into chat, redact it.
function runBridgeSubcommand(args, { timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), ...args],
      { stdio: ["ignore", "pipe", "pipe"], env: process.env },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        ok: false,
        code: "TIMEOUT",
        stdout,
        stderr,
        message: `Bridge subcommand ${args[0] || ""} did not finish within ${timeoutMs}ms.`,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        ok: false,
        code: "SPAWN_ERROR",
        stdout,
        stderr,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let parsed = null;
      try {
        parsed = stdout ? JSON.parse(stdout) : null;
      } catch {
        parsed = null;
      }
      finish({
        ok: code === 0,
        code: code === 0 ? "OK" : `EXIT_${code ?? "NULL"}`,
        stdout,
        stderr,
        exitCode: code,
        parsed,
      });
    });
  });
}

async function setup(args) {
  // End-to-end wizard for Codex. Walks the state machine in one invocation:
  //   1. install (with --yes/--confirm)
  //   2. set OPENLOOMI_AGENT_PROVIDER=codex in the GUI launchd/environment.d
  //      so the OpenLoomi Desktop app routes its chat/agent through Codex
  //   3. launch the OpenLoomi desktop app and wait for the local API
  //   4. mint a guest/session token via the local API
  //
  // We deliberately do NOT auto-configure the AI provider: secret entry
  // must happen in OpenLoomi-owned UI per the SKILL secrets contract.
  const flags = parseFlags(args);
  const yesFlag = !!flags.yes || !!flags.confirm;
  const maxWaitMs = Number(flags["max-wait"] || 30_000);
  const maxSteps = 8; // hard ceiling on chained transitions
  const steps = [];

  const record = (name, ok, detail) => {
    steps.push({ step: name, ok, at: Date.now(), ...(detail || {}) });
  };

  for (let i = 0; i < maxSteps; i += 1) {
    const status = await buildSetupStatus();

    // Final-readiness check. We treat BOTH READY and
    // READY_SESSION_BOOTSTRAP_PENDING as success states because step 4
    // (initialize-session) below will mint the token on the next loop
    // iteration when we get there.
    if (status.reason === "READY" && status.codexRuntimeEnvSet) {
      record("status_check", true, {
        reason: status.reason,
        codexRuntimeEnvSet: true,
      });
      writeJson({
        ok: true,
        setup: "ready",
        steps,
        status,
        message: "OpenLoomi is ready and the desktop app is wired to Codex.",
      });
      return;
    }

    if (status.reason === "READY" && !status.codexRuntimeEnvSet) {
      // Runtime is good but the GUI is still on Claude. Fall through to
      // step 2 to set OPENLOOMI_AGENT_PROVIDER.
    }

    // 1. Install (only with explicit user approval via --yes / --confirm).
    if (!status.installed && status.nextAction === "install_openloomi") {
      record("status_check", false, { reason: status.reason });
      if (!yesFlag) {
        writeJson({
          ok: false,
          setup: "awaiting_user_action",
          steps,
          status,
          nextAction: "confirm_install_openloomi",
          reason: "INSTALL_CONFIRMATION_REQUIRED",
          message:
            "OpenLoomi is not installed. Re-run with --yes to install from the official release, or install manually and retry.",
        });
        return;
      }
      const r = await runBridgeSubcommand(["install-openloomi", "--confirm"], {
        timeoutMs: 15 * 60 * 1000,
      });
      const ok = r.ok && r.parsed && r.parsed.installed !== false;
      record("install", ok, {
        code: r.code,
        exitCode: r.exitCode,
        reason: r.parsed && r.parsed.reason,
      });
      if (!ok) {
        writeJson({
          ok: false,
          setup: "install_failed",
          steps,
          status,
          install: r.parsed,
          message:
            r.parsed?.message ||
            "OpenLoomi installation did not complete. Follow the reported nextAction.",
        });
        return;
      }
      continue;
    }

    // 2. Set OPENLOOMI_AGENT_PROVIDER=codex in the host GUI launchd /
    //    environment.d, or return Windows user-env guidance. On macOS the change only affects
    //    processes started AFTER launchctl setenv, so we additionally
    //    return runtime_env_set_pending_restart when we know the GUI is
    //    already running.
    if (status.installed && !status.codexRuntimeEnvSet) {
      record("status_check", false, {
        reason: status.reason,
        codexRuntimeEnvSet: false,
      });
      const r = await runBridgeSubcommand(
        ["set-codex-runtime-env", "codex", "--persist"],
        { timeoutMs: 10_000 },
      );
      const ok = r.ok && r.parsed && r.parsed.ok === true;
      record("runtime_env", ok, {
        code: r.code,
        before: r.parsed && r.parsed.before,
        after: r.parsed && r.parsed.after,
        platform: r.parsed && r.parsed.platform,
      });
      if (!ok) {
        writeJson({
          ok: false,
          setup: "runtime_env_failed",
          steps,
          status,
          runtimeEnv: r.parsed,
          message:
            r.parsed?.message ||
            "Failed to write OPENLOOMI_AGENT_PROVIDER=codex to the host environment. Follow the manual steps in codex-runtime-info.",
        });
        return;
      }
      // Even when the write succeeded, the GUI app already running
      // didn't inherit the change. Surface that so the caller knows
      // Quit+Reopen is still required.
      writeJson({
        ok: true,
        setup: "runtime_env_set_pending_restart",
        steps,
        status,
        runtimeEnv: r.parsed,
        message:
          "OPENLOOMI_AGENT_PROVIDER=codex is now set in the host environment and a LaunchAgent has been installed so the change survives logout/reboot. Quit and reopen OpenLoomi Desktop for the change to take effect in the running web server.",
      });
      return;
    }

    // 3. Installed + runtime env set, but the desktop app is not yet
    //    running (or the API isn't reachable). Launch the app and wait
    //    for the local HTTP API to come up.
    if (status.installed && !status.apiReachable) {
      record("status_check", false, {
        reason: status.reason,
        apiReachable: false,
      });
      const launch = await launchDesktopApp({ ctlPath: status.ctlPath });
      record("launch", !!launch.ok, {
        code: launch.code,
        via: launch.via,
        appPath: launch.appPath,
      });
      if (!launch.ok) {
        writeJson({
          ok: false,
          setup: "launch_failed",
          steps,
          status,
          launch,
          message:
            launch.message ||
            "Could not launch OpenLoomi Desktop. Open it manually once, then re-run setup.",
        });
        return;
      }
      const wait = await waitForApi({ timeoutMs: maxWaitMs });
      record("wait_api", !!wait.ok, {
        elapsedMs: wait.elapsedMs,
        url: wait.url,
        code: wait.code,
      });
      if (!wait.ok) {
        writeJson({
          ok: false,
          setup: "api_not_ready",
          steps,
          status,
          wait,
          message:
            "OpenLoomi was launched but the local HTTP API did not become reachable in time. Wait for the desktop app to finish loading, then re-run setup.",
        });
        return;
      }
      continue;
    }

    // 4. Installed, API reachable, no token yet -> ask the local OpenLoomi
    //    API to mint a guest/session bearer.
    if (status.installed && status.apiReachable && !status.tokenPresent) {
      record("status_check", false, { reason: status.reason });
      const r = await runBridgeSubcommand(["initialize-session"], {
        timeoutMs: maxWaitMs + 10_000,
      });
      const ok = r.ok && r.parsed && r.parsed.ready === true;
      record("initialize_session", ok, {
        code: r.code,
        exitCode: r.exitCode,
        reason: r.parsed && r.parsed.reason,
      });
      if (!ok) {
        writeJson({
          ok: true,
          setup: "awaiting_user_action",
          steps,
          status,
          session: r.parsed,
          nextAction: "open_openloomi",
          reason: "SESSION_INITIALIZATION_REQUIRED",
          message:
            "Open OpenLoomi once so it can create a guest session, then re-run setup.",
        });
        return;
      }
      continue;
    }

    // 5. No automatic transition matches. Surface a clear next step.
    //    The realistic stops here are:
    //      - AI_PROVIDER_REQUIRED -> walk the user through OpenLoomi Desktop
    //        Settings. Do NOT auto-call configure-ai-provider with a key.
    //      - INSTALL_REQUIRED without --yes -> already handled above.
    //      - any other upstream state -> just hand back the status.
    record("status_check", false, { reason: status.reason });
    writeJson({
      ok: true,
      setup: "awaiting_user_action",
      steps,
      status,
      nextAction: status.nextAction,
      reason: status.reason,
      message: status.message,
    });
    return;
  }

  const final = await buildSetupStatus();
  writeJson({
    ok: false,
    setup: "step_limit_reached",
    steps,
    status: final,
    message: `Setup did not reach READY within ${maxSteps} steps. Follow the reported nextAction.`,
  });
}

async function run() {
  const flags = parseFlags(process.argv.slice(3));
  const prompt = await readStdin();

  if (!hasValue(prompt)) {
    writeJson(
      {
        ready: false,
        nextAction: "provide_stdin_prompt",
        reason: "PROMPT_REQUIRED",
        message:
          "Pass the task prompt over stdin. Do not place long prompts or secrets in command-line arguments.",
      },
      1,
    );
    return;
  }

  let setup = await buildSetupStatus();

  if (!setup.ready) {
    writeJson(
      {
        ...setup,
        ran: false,
        command: "run",
        message:
          "OpenLoomi is not ready for one-shot execution. Complete the reported nextAction first.",
      },
      1,
    );
    return;
  }

  const session = await ensureOpenLoomiSession();

  if (!session.ready) {
    writeJson(
      {
        ready: false,
        ran: false,
        command: "run",
        nextAction: session.nextAction,
        reason: session.reason,
        message: session.message,
        session: session.session,
      },
      1,
    );
    return;
  }

  if (setup.sessionInitializationRequired) {
    setup = await buildSetupStatus();

    if (!setup.ready) {
      writeJson(
        {
          ...setup,
          ran: false,
          command: "run",
          message:
            "OpenLoomi session is initialized, but setup is still not ready for one-shot execution.",
        },
        1,
      );
      return;
    }
  }

  const permissionMode = getPermissionMode(flags.permissionMode);
  const runLock = acquireRunLock();

  if (!runLock.acquired) {
    writeJson(
      {
        ready: false,
        ran: false,
        command: "run",
        nextAction: "return_without_bridge",
        reason: "RECURSION_GUARD",
        message:
          "A loomi-bridge run is already active. Refusing nested OpenLoomi bridge invocation.",
        lock: summarizeRunLock(runLock.existing),
      },
      1,
    );
    return;
  }

  let result;

  try {
    result = await runOpenLoomiOneShot({
      ctlPath: setup.ctlPath,
      permissionMode,
      prompt,
    });
  } finally {
    releaseRunLock(runLock);
  }

  if (result.exitCode !== 0) {
    writeJson(
      {
        ready: false,
        ran: true,
        ...normalizeRunFailure(result),
      },
      1,
    );
    return;
  }

  writeJson({
    ready: true,
    ran: true,
    nextAction: "done",
    reason: "RUN_COMPLETE",
    result: parseJsonOrText(result.stdout),
    openloomi: {
      exitCode: result.exitCode,
      signal: result.signal,
      stderrPresent: hasValue(result.stderr),
    },
  });
}

function help() {
  writeJson({
    usage: "node scripts/loomi-bridge.mjs <command>",
    commands: Array.from(COMMANDS).sort(),
  });
}

async function discoverOpenLoomi() {
  const checked = [];
  const explicitCtl = process.env.OPENLOOMI_CTL;

  if (explicitCtl) {
    const result = await validateCtlPath(expandHome(explicitCtl), {
      mode: "packaged",
      source: "OPENLOOMI_CTL",
      checked,
    });

    if (result.status === "found" || result.status === "invalid") {
      return result;
    }
  }

  for (const envName of ["OPENLOOMI_HOME", "OPENLOOMI_INSTALL_DIR"]) {
    const root = process.env[envName];

    if (!root) {
      continue;
    }

    const result = await validateRootCandidates(expandHome(root), {
      mode: "packaged",
      source: envName,
      checked,
    });

    if (result.status === "found" || result.status === "invalid") {
      return result;
    }
  }

  const sourceRoot = process.env.OPENLOOMI_REPO_DIR;

  if (sourceRoot) {
    const result = await inspectSourceCheckout(expandHome(sourceRoot), {
      source: "OPENLOOMI_REPO_DIR",
      checked,
    });

    if (result.status === "found" || result.status === "source-missing-cli") {
      return result;
    }
  }

  const pathResult = await validatePathLookup(checked);

  if (pathResult.status === "found") {
    return pathResult;
  }

  const platformRoots = getPlatformInstallRoots();
  let platformCandidatesChecked = 0;

  for (const root of platformRoots) {
    const platformChecked = [];
    const result = await validateRootCandidates(root, {
      mode: "packaged",
      source: "platform-default",
      checked: platformChecked,
    });
    platformCandidatesChecked += getCtlCandidatesForRoot(root).length;

    if (result.status === "found" || result.status === "invalid") {
      return {
        ...result,
        checked: [...checked, ...platformChecked],
      };
    }
  }

  checked.push({
    source: "platform-default",
    present: false,
    rootsChecked: platformRoots.length,
    candidatesChecked: platformCandidatesChecked,
  });

  const savedConfig = getSavedConfigCandidates();

  for (const config of savedConfig) {
    if (config.ctlPath) {
      const result = await validateCtlPath(config.ctlPath, {
        mode: "packaged",
        source: config.source,
        checked,
      });

      if (result.status === "found") {
        return result;
      }
    }

    if (config.root) {
      const result = await validateRootCandidates(config.root, {
        mode: "packaged",
        source: config.source,
        checked,
      });

      if (result.status === "found") {
        return result;
      }
    }
  }

  const cwdSource = await inspectSourceCheckout(process.cwd(), {
    source: "current-working-directory",
    checked,
  });

  if (
    cwdSource.status === "found" ||
    cwdSource.status === "source-missing-cli"
  ) {
    return cwdSource;
  }

  return {
    status: "missing",
    mode: "unconfigured",
    installed: false,
    ctlPath: null,
    version: null,
    source: null,
    sourceRoot: null,
    checked,
  };
}

async function validatePathLookup(checked) {
  const candidates = findOnPath("openloomi-ctl");

  for (const candidate of candidates) {
    const result = await validateCtlPath(candidate, {
      mode: "packaged",
      source: "PATH",
      checked,
      recordMissing: false,
    });

    if (result.status === "found") {
      return result;
    }
  }

  checked.push({
    source: "PATH",
    present: false,
    candidatesChecked: candidates.length,
  });

  return {
    status: "missing",
  };
}

async function inspectSourceCheckout(root, options) {
  const normalizedRoot = normalizePath(root);

  if (!normalizedRoot || !isDirectory(normalizedRoot)) {
    options.checked.push({
      source: options.source,
      present: false,
      ...debugPath("path", normalizedRoot),
    });

    return {
      status: "missing",
    };
  }

  if (!isSourceCheckout(normalizedRoot)) {
    options.checked.push({
      source: options.source,
      present: false,
      reason: "SOURCE_MARKERS_NOT_FOUND",
      ...debugPath("path", normalizedRoot),
    });

    return {
      status: "missing",
    };
  }

  const result = await validateRootCandidates(normalizedRoot, {
    mode: "source",
    source: options.source,
    checked: options.checked,
  });

  if (result.status === "found") {
    return {
      ...result,
      sourceRoot: normalizedRoot,
    };
  }

  return {
    status: "source-missing-cli",
    mode: "source",
    installed: false,
    ctlPath: null,
    version: null,
    source: options.source,
    sourceRoot: normalizedRoot,
    checked: options.checked,
  };
}

async function validateRootCandidates(root, options) {
  const normalizedRoot = normalizePath(root);
  const candidates = getCtlCandidatesForRoot(normalizedRoot);

  for (const candidate of candidates) {
    const result = await validateCtlPath(candidate, {
      ...options,
      recordMissing: false,
    });

    if (result.status === "found") {
      return result;
    }
  }

  options.checked.push({
    source: options.source,
    present: false,
    candidatesChecked: candidates.length,
    ...debugPath("root", normalizedRoot),
  });

  return {
    status: "missing",
  };
}

async function validateCtlPath(candidate, options) {
  const normalizedPath = normalizePath(candidate);

  if (!normalizedPath || !isFile(normalizedPath)) {
    if (options.recordMissing !== false) {
      options.checked.push({
        source: options.source,
        present: false,
        ...debugPath("path", normalizedPath),
      });
    }

    return {
      status: "missing",
    };
  }

  const versionResult = await runCommand(normalizedPath, ["--version"]);
  const version = firstLine(versionResult.stdout || versionResult.stderr);

  options.checked.push({
    source: options.source,
    present: true,
    versionValid: versionResult.exitCode === 0,
    ...debugPath("path", normalizedPath),
  });

  if (versionResult.exitCode !== 0) {
    return {
      status: "invalid",
      mode: options.mode,
      installed: false,
      ctlPath: normalizedPath,
      version,
      source: options.source,
      sourceRoot: null,
      checked: options.checked,
      commandError: {
        exitCode: versionResult.exitCode,
        signal: versionResult.signal,
      },
    };
  }

  return {
    status: "found",
    mode: options.mode,
    installed: true,
    ctlPath: normalizedPath,
    version,
    source: options.source,
    sourceRoot: null,
    checked: options.checked,
  };
}

function getReadinessDecision(
  discovery,
  token,
  aiProvider,
  codexRuntimeEnv,
  apiProbe,
  nativeProviderStatus,
) {
  // codexRuntimeEnv is intentionally NOT a gate here: a missing
  // OPENLOOMI_AGENT_PROVIDER only blocks the OpenLoomi GUI desktop from
  // routing through Codex; the bridge itself can still drive openloomi-ctl.
  // The setup state machine handles that branch separately.
  void codexRuntimeEnv;
  const nativeCodexRuntimeReady = Boolean(nativeProviderStatus?.active);

  if (discovery.status === "invalid") {
    return {
      ready: false,
      nextAction: "provide_install_or_repo_path",
      reason: "OPENLOOMI_CTL_INVALID",
    };
  }

  if (discovery.status === "source-missing-cli") {
    return {
      ready: false,
      nextAction: "build_or_stage_openloomi_ctl",
      reason: "SOURCE_FOUND_CLI_NOT_BUILT",
    };
  }

  if (!discovery.installed) {
    return {
      ready: false,
      nextAction: "install_openloomi",
      reason: "INSTALL_REQUIRED",
    };
  }

  // The setup state machine has its own launch + wait_api step. When the
  // API is unreachable and we don't yet have a token, surface that
  // explicitly so callers know to either open the app or wait for setup
  // to drive launchDesktopApp.
  if (!token.present && apiProbe && !apiProbe.reachableUrl) {
    return {
      ready: false,
      nextAction: "open_openloomi",
      reason: "OPENLOOMI_API_UNREACHABLE",
      sessionInitializationRequired: true,
      message:
        "OpenLoomi is installed but the local API is not reachable. Open OpenLoomi Desktop, or run `setup --yes` to install + launch + mint a guest session automatically.",
    };
  }

  if (!token.present && !aiProvider.configured) {
    return {
      ready: true,
      nextAction: "run",
      reason: "READY_SESSION_BOOTSTRAP_PENDING",
      sessionInitializationRequired: true,
      message: nativeCodexRuntimeReady
        ? "OpenLoomi is installed and the native Codex runtime is active. The bridge will initialize a local guest/session token on run before execution."
        : "OpenLoomi is installed. The bridge will initialize a local guest/session token on run, then re-check OpenLoomi AI provider settings.",
    };
  }

  if (!aiProvider.configured && nativeCodexRuntimeReady) {
    return {
      ready: true,
      nextAction: "run",
      reason: "READY",
      readinessSource: "native_codex_runtime",
      message:
        "OpenLoomi is ready through the native Codex runtime. A separate OpenLoomi AI provider is not required for native Codex execution.",
    };
  }

  if (aiProvider.status === "runtime_status_unavailable") {
    return {
      ready: false,
      nextAction: "open_openloomi",
      reason: "AI_PROVIDER_STATUS_UNAVAILABLE",
      message:
        "OpenLoomi AI provider configuration could not be confirmed because the local OpenLoomi API is not reachable. Open OpenLoomi, then retry setup-status.",
    };
  }

  if (!aiProvider.configured) {
    return {
      ready: false,
      nextAction: "configure_ai_provider",
      reason: "AI_PROVIDER_REQUIRED",
    };
  }

  if (!token.present) {
    return {
      ready: true,
      nextAction: "run",
      reason: "READY_SESSION_BOOTSTRAP_PENDING",
      sessionInitializationRequired: true,
      message:
        "OpenLoomi is installed and provider setup appears available. The bridge will initialize a local guest/session token on run when possible.",
    };
  }

  return {
    ready: true,
    nextAction: "run",
    reason: "READY",
  };
}

function getTokenStatus() {
  const checked = [
    {
      key: "OPENLOOMI_AUTH_TOKEN",
      present: hasValue(process.env.OPENLOOMI_AUTH_TOKEN),
      source: "env",
    },
  ];

  const tokenPath = getOpenLoomiTokenPath();

  checked.push({
    key: "~/.openloomi/token",
    present: isFile(tokenPath),
    source: "file",
  });

  return {
    present: checked.some((item) => item.present),
    checked,
  };
}

function getOpenLoomiTokenPath() {
  return path.join(os.homedir(), ".openloomi", "token");
}

function readOpenLoomiAuthToken(tokenStatus = getTokenStatus()) {
  if (hasValue(process.env.OPENLOOMI_AUTH_TOKEN)) {
    return process.env.OPENLOOMI_AUTH_TOKEN.trim();
  }

  if (
    !tokenStatus.checked.some(
      (item) => item.key === "~/.openloomi/token" && item.present,
    )
  ) {
    return null;
  }

  try {
    return Buffer.from(readFileText(getOpenLoomiTokenPath()).trim(), "base64")
      .toString("utf8")
      .trim();
  } catch {
    return null;
  }
}

async function getAiProviderStatus(tokenStatus = getTokenStatus()) {
  // AI provider readiness is the runtime's job — the bridge never reads
  // provider env vars as a source of truth. The runtime's
  // `/api/preferences/ai` is the sole signal (it owns user-saved
  // settings, the native CLI auth probe where applicable, and the
  // system defaults).
  const runtime = await getRuntimeAiProviderStatus(tokenStatus);

  return {
    configured: runtime.configured,
    status: runtime.configured ? "runtime_configured" : runtime.status,
    runtime,
    // `checked` is intentionally empty: the bridge previously surfaced
    // env-var names + presence here, but the bridge no longer reads
    // provider env vars at all. The empty array keeps the JSON shape
    // stable for any tooling that introspects the field.
    checked: [],
  };
}

async function getRuntimeAiProviderStatus(tokenStatus) {
  if (!tokenStatus.present) {
    return {
      configured: false,
      status: "token_missing",
      source: "openloomi-runtime",
      checked: false,
      attempts: [],
      providers: [],
    };
  }

  const token = readOpenLoomiAuthToken(tokenStatus);

  if (!hasValue(token)) {
    return {
      configured: false,
      status: "token_unreadable",
      source: "openloomi-runtime",
      checked: false,
      attempts: [],
      providers: [],
    };
  }

  const attempts = [];

  for (const baseUrl of getLocalApiBaseUrls()) {
    const result = await requestAiProviderStatus(baseUrl, token);
    attempts.push(summarizeRuntimeAiProviderAttempt(result));

    if (result.providers) {
      return {
        configured: result.configured,
        status: result.configured ? "runtime_configured" : "runtime_missing",
        source: "openloomi-runtime",
        checked: true,
        baseUrl,
        attempts,
        providers: result.providers,
      };
    }
  }

  return {
    configured: false,
    status: "runtime_status_unavailable",
    source: "openloomi-runtime",
    checked: false,
    attempts,
    providers: [],
  };
}

async function requestAiProviderStatus(baseUrl, token) {
  try {
    const sessionResponse = await fetchWithTimeout(
      `${baseUrl}/api/auth/set-token?token=${encodeURIComponent(token)}`,
      {
        method: "GET",
        redirect: "manual",
      },
      SESSION_API_TIMEOUT_MS,
    );
    const cookieHeader = toCookieHeader(
      getSetCookieHeaders(sessionResponse.headers),
    );

    if (!cookieHeader) {
      return {
        baseUrl,
        status: sessionResponse.status,
        reason: "SESSION_COOKIE_MISSING",
      };
    }

    const preferencesResponse = await fetchWithTimeout(
      `${baseUrl}/api/preferences/ai`,
      {
        headers: {
          Cookie: cookieHeader,
        },
        redirect: "manual",
      },
      SESSION_API_TIMEOUT_MS,
    );

    if (!preferencesResponse.ok) {
      return {
        baseUrl,
        status: preferencesResponse.status,
        reason: "PREFERENCES_REQUEST_FAILED",
      };
    }

    const payload = await preferencesResponse.json();
    const providers = summarizeAiPreferencePayload(payload);

    return {
      baseUrl,
      status: preferencesResponse.status,
      reason: "PREFERENCES_LOADED",
      configured: providers.some((provider) => provider.configured),
      providers,
    };
  } catch (error) {
    return {
      baseUrl,
      reason: error?.name === "AbortError" ? "API_TIMEOUT" : "API_UNREACHABLE",
    };
  }
}

function summarizeAiPreferencePayload(payload) {
  const settings = Array.isArray(payload?.settings) ? payload.settings : [];
  const defaults = payload?.systemDefaults || {};
  const providerTypes = ["openai_compatible", "anthropic_compatible"];

  return providerTypes.map((providerType) => {
    const setting = settings.find(
      (candidate) => candidate?.providerType === providerType,
    );
    const systemDefault = defaults?.[providerType] || {};
    const enabled = Boolean(setting?.enabled);
    const hasApiKey = Boolean(setting?.hasApiKey);
    const baseUrlPresent = Boolean(setting?.baseUrl);
    const modelPresent = Boolean(setting?.model);
    const userConfigured = Boolean(
      enabled && hasApiKey && baseUrlPresent && modelPresent,
    );
    const systemConfigured = Boolean(
      systemDefault?.hasApiKey &&
      systemDefault?.baseUrl &&
      systemDefault?.model,
    );

    return {
      providerType,
      configured: userConfigured || systemConfigured,
      source: userConfigured
        ? "openloomi-ui"
        : systemConfigured
          ? "openloomi-system-defaults"
          : "openloomi-runtime",
      enabled,
      hasApiKey,
      baseUrlPresent,
      modelPresent,
      systemDefaultConfigured: systemConfigured,
    };
  });
}

function summarizeRuntimeAiProviderAttempt(result) {
  return {
    baseUrl: result.baseUrl,
    status: result.status || null,
    reason: result.reason,
    providerStatusAvailable: Boolean(result.providers),
  };
}

function getCtlCandidatesForRoot(root) {
  const normalizedRoot = normalizePath(root);

  if (!normalizedRoot) {
    return [];
  }

  const names = getCtlNames();
  const directories = [
    "",
    "bin",
    "cli",
    path.join("resources", "cli"),
    path.join("src-tauri", "cli"),
    path.join("target", "release"),
    path.join("apps", "web", "src-tauri", "cli"),
    path.join("apps", "web", "src-tauri", "target", "release"),
  ];

  return unique(
    directories.flatMap((directory) =>
      names.map((name) => path.join(normalizedRoot, directory, name)),
    ),
  );
}

function getCtlNames() {
  if (process.platform === "win32") {
    return [
      "openloomi-ctl.exe",
      "openloomi-ctl.cmd",
      "openloomi-ctl.bat",
      "openloomi-ctl",
    ];
  }

  return ["openloomi-ctl"];
}

function getPlatformInstallRoots() {
  const home = os.homedir();

  if (process.platform === "win32") {
    return unique(
      [
        process.env.LOCALAPPDATA &&
          path.join(process.env.LOCALAPPDATA, "OpenLoomi"),
        process.env.LOCALAPPDATA &&
          path.join(process.env.LOCALAPPDATA, "openloomi"),
        process.env.APPDATA && path.join(process.env.APPDATA, "OpenLoomi"),
        process.env.ProgramFiles &&
          path.join(process.env.ProgramFiles, "OpenLoomi"),
        process.env["ProgramFiles(x86)"] &&
          path.join(process.env["ProgramFiles(x86)"], "OpenLoomi"),
      ].filter(Boolean),
    );
  }

  if (process.platform === "darwin") {
    return [
      "/Applications/OpenLoomi.app/Contents/Resources",
      "/Applications/OpenLoomi.app/Contents/MacOS",
      path.join(home, "Applications", "OpenLoomi.app", "Contents", "Resources"),
      path.join(home, ".openloomi"),
    ];
  }

  return [
    "/opt/openloomi",
    "/usr/local/openloomi",
    path.join(home, ".local", "share", "openloomi"),
    path.join(home, ".openloomi"),
  ];
}

function getSavedConfigCandidates() {
  const candidates = [];
  const configPath = path.join(os.homedir(), ".openloomi", "codex-plugin.json");

  if (!isFile(configPath)) {
    return candidates;
  }

  try {
    const config = JSON.parse(readFileText(configPath));

    if (typeof config.openloomiCtl === "string") {
      candidates.push({
        ctlPath: expandHome(config.openloomiCtl),
        source: "~/.openloomi/codex-plugin.json",
      });
    }

    if (typeof config.openloomiHome === "string") {
      candidates.push({
        root: expandHome(config.openloomiHome),
        source: "~/.openloomi/codex-plugin.json",
      });
    }
  } catch {
    candidates.push({
      source: "~/.openloomi/codex-plugin.json",
      invalid: true,
    });
  }

  return candidates;
}

function findOnPath(commandName) {
  const pathValue = process.env.PATH || "";
  const names = process.platform === "win32" ? getCtlNames() : [commandName];

  return unique(
    pathValue
      .split(path.delimiter)
      .flatMap((directory) => names.map((name) => path.join(directory, name))),
  );
}

function isSourceCheckout(root) {
  return (
    isFile(path.join(root, "package.json")) &&
    isFile(path.join(root, "apps", "web", "src-tauri", "Cargo.toml"))
  );
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        signal: null,
        stdout,
        stderr: error.message,
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

function appendLimited(current, chunk) {
  return `${current}${chunk.toString("utf8")}`.slice(0, MAX_COMMAND_OUTPUT);
}

function firstLine(value) {
  const line = String(value || "")
    .split(/\r?\n/)
    .find((entry) => entry.trim().length > 0);

  return line ? line.trim() : null;
}

function readFileText(filePath) {
  return isFile(filePath) ? readFileSync(filePath, "utf8") : "";
}

function isFile(filePath) {
  try {
    return (
      Boolean(filePath) && existsSync(filePath) && statSync(filePath).isFile()
    );
  } catch {
    return false;
  }
}

function isDirectory(filePath) {
  try {
    return (
      Boolean(filePath) &&
      existsSync(filePath) &&
      statSync(filePath).isDirectory()
    );
  } catch {
    return false;
  }
}

function normalizePath(value) {
  return value ? path.resolve(expandHome(value)) : null;
}

function expandHome(value) {
  if (!value || !value.startsWith("~")) {
    return value;
  }

  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith(`~${path.sep}`) || value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function debugPath(key, value) {
  return DEBUG_DISCOVERY && value ? { [key]: value } : {};
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);

    if (process.stdin.isTTY) {
      resolve("");
    }
  });
}

// ---------------------------------------------------------------------------
// pet <state>
//
// Mirrors `cmdPet` in plugins/claude/scripts/loomi-bridge.mjs. Validates
// the requested state against the shared 9-state vocabulary and POSTs
// {state, source} to /api/pet/state on the local OpenLoomi runtime with
// the bearer token from ~/.openloomi/token. Returns structured failure
// codes (MISSING_STATE / INVALID_STATE / TOKEN_MISSING /
// ENDPOINT_MISSING / API_UNREACHABLE / PET_FAILED) and never throws.
// ---------------------------------------------------------------------------
async function petCommand(args) {
  const state = args && args.length > 0 ? args[0] : null;

  if (!state) {
    return writeJson(
      {
        ok: false,
        code: "MISSING_STATE",
        message: "pet requires a state argument.",
        validStates: CAPYBARA_STATES_LIST,
      },
      0,
    );
  }

  if (!CAPYBARA_STATES.has(state)) {
    return writeJson(
      {
        ok: false,
        code: "INVALID_STATE",
        message: `pet state '${state}' is not recognised.`,
        received: state,
        validStates: CAPYBARA_STATES_LIST,
      },
      0,
    );
  }

  const tokenStatus = getTokenStatus();
  const token = readOpenLoomiAuthToken(tokenStatus);
  if (!token) {
    return writeJson(
      {
        ok: false,
        code: "TOKEN_MISSING",
        message:
          "OpenLoomi session token is missing. Run setup (or initialize-session) first so ~/.openloomi/token is populated, then retry pet.",
        state,
      },
      0,
    );
  }

  const attempts = [];

  for (const baseUrl of getLocalApiBaseUrls()) {
    const result = await postPetState(baseUrl, state, token, {
      source: "codex-plugin",
    });
    attempts.push(result.attempt);

    if (result.ok) {
      return writeJson({
        ok: true,
        code: "PET_STATE_SET",
        state,
        baseUrl,
        attempts,
        response: result.response,
      });
    }

    if (result.code === "ENDPOINT_MISSING") {
      return writeJson(
        {
          ok: false,
          code: "ENDPOINT_MISSING",
          state,
          baseUrl,
          attempts,
          message:
            "OpenLoomi runtime is reachable, but the Pet state endpoint is not available in this build.",
        },
        0,
      );
    }

    if (result.code === "PET_FAILED") {
      return writeJson(
        {
          ok: false,
          code: "PET_FAILED",
          state,
          baseUrl,
          attempts,
          response: result.response,
        },
        0,
      );
    }
  }

  return writeJson(
    {
      ok: false,
      code: "API_UNREACHABLE",
      state,
      attempts,
      message: "Could not reach OpenLoomi Pet state API on any local URL.",
    },
    0,
  );
}

function parseStateCommandArgs(args) {
  const out = {
    state: args && args.length > 0 ? args[0] : null,
    event: null,
    quiet: false,
  };
  for (let i = 1; i < (args || []).length; i += 1) {
    const arg = args[i];
    if (arg === "--event" && args[i + 1]) {
      out.event = args[i + 1];
      i += 1;
    } else if (arg === "--quiet") {
      out.quiet = true;
    }
  }
  return out;
}

async function stateCommand(args) {
  const { state, event, quiet } = parseStateCommandArgs(args || []);
  const finish = (payload) => {
    if (quiet) {
      return;
    }
    return writeJson(payload);
  };

  if (!state) {
    return finish({
      ok: false,
      state: null,
      event,
      hook: "skipped",
      reason: "missing_state",
      validStates: CAPYBARA_STATES_LIST,
    });
  }

  if (!CAPYBARA_STATES.has(state)) {
    return finish({
      ok: false,
      state,
      event,
      hook: "skipped",
      reason: "invalid_state",
      validStates: CAPYBARA_STATES_LIST,
    });
  }

  const tokenStatus = getTokenStatus();
  const token = readOpenLoomiAuthToken(tokenStatus);
  if (!token) {
    return finish({
      ok: false,
      state,
      event,
      hook: "skipped",
      reason: "token_missing",
    });
  }

  const attempts = [];

  for (const baseUrl of getLocalApiBaseUrls()) {
    const result = await postPetState(baseUrl, state, token, {
      source: "codex-plugin",
      event,
      timeoutMs: PET_HTTP_TIMEOUT_MS,
    });
    attempts.push(result.attempt);

    if (result.ok) {
      return finish({
        ok: true,
        state,
        event,
        hook: "sent",
        baseUrl,
      });
    }

    if (result.code === "ENDPOINT_MISSING") {
      return finish({
        ok: false,
        state,
        event,
        hook: "skipped",
        reason: "endpoint_missing",
        baseUrl,
        attempts,
      });
    }

    if (result.code === "PET_FAILED") {
      return finish({
        ok: false,
        state,
        event,
        hook: "skipped",
        reason: "pet_failed",
        baseUrl,
        attempts,
      });
    }
  }

  return finish({
    ok: false,
    state,
    event,
    hook: "skipped",
    reason: "api_unreachable",
    attempts,
  });
}

async function main() {
  const command = process.argv[2] || "help";

  if (!COMMANDS.has(command)) {
    writeJson(
      {
        error: "UNKNOWN_COMMAND",
        message: `Unknown command: ${command}`,
        commands: Array.from(COMMANDS).sort(),
      },
      1,
    );
    return;
  }

  switch (command) {
    case "codex-runtime-info":
      codexRuntimeInfo();
      break;
    case "configure-ai-provider":
      await configureAiProvider(process.argv.slice(3));
      break;
    case "help":
      help();
      break;
    case "initialize-session":
      await initializeSession();
      break;
    case "install-openloomi":
      await installOpenLoomi(process.argv.slice(3));
      break;
    case "install-instructions":
      installInstructions();
      break;
    case "pet":
      await petCommand(process.argv.slice(3));
      break;
    case "run":
      await run();
      break;
    case "set-codex-runtime-env":
      await setCodexRuntimeEnv(process.argv.slice(3));
      break;
    case "setup":
      await setup(process.argv.slice(3));
      break;
    case "setup-status":
      await setupStatus();
      break;
    case "state":
      await stateCommand(process.argv.slice(3));
      break;
    case "version":
      version();
      break;
    case "workflow-guidance":
      workflowGuidance(process.argv.slice(3));
      break;
  }
}

main().catch((error) => {
  writeJson(
    {
      error: "BRIDGE_ERROR",
      message: error instanceof Error ? error.message : String(error),
    },
    1,
  );
});
