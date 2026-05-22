import type { IntegrationId } from "@/hooks/use-integrations";
import { normalizeIntegrationPlatform } from "@/lib/integrations/connector-target";

export const CONNECTOR_AUTHORIZATION_RESULT_EVENT =
  "openloomi:connector-authorization-result";
export const CONNECTOR_AUTHORIZATION_PENDING_ID_PARAM = "connectorPendingId";

const PENDING_RESUME_KEY = "openloomi:pending-connector-chat-resume";
const PENDING_RESUME_MAP_KEY = "openloomi:pending-connector-chat-resumes";
const AUTHORIZATION_RESULT_KEY = "openloomi:connector-authorization-result";
const RESUME_TAB_NAME_PREFIX = "openloomi:connector-resume-tab:";
const PENDING_TTL_MS = 15 * 60 * 1000;
const RESULT_TTL_MS = 5 * 60 * 1000;

export type PendingConnectorResume = {
  id: string;
  chatId: string;
  platform: IntegrationId;
  reason?: string;
  returnTo?: string;
  sourceTabId?: string;
  createdAt: number;
};

export type ConnectorAuthorizationResult = {
  id: string;
  pendingId?: string;
  platform: IntegrationId;
  status: "success" | "error" | "cancelled";
  error?: string;
  createdAt: number;
};

function getBrowserWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

function createId() {
  const cryptoApi = getBrowserWindow()?.crypto ?? globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function safeReadJson<T>(key: string): T | null {
  const browserWindow = getBrowserWindow();
  if (!browserWindow) return null;

  try {
    const raw = browserWindow.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    try {
      browserWindow.localStorage.removeItem(key);
    } catch {
      // Ignore storage cleanup failures.
    }
    return null;
  }
}

function safeWriteJson(key: string, value: unknown) {
  const browserWindow = getBrowserWindow();
  if (!browserWindow) return;

  try {
    browserWindow.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota or unavailable-storage failures.
  }
}

function safeRemove(key: string) {
  const browserWindow = getBrowserWindow();
  if (!browserWindow) return;

  try {
    browserWindow.localStorage.removeItem(key);
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function getConnectorResumeTabId() {
  const browserWindow = getBrowserWindow();
  if (!browserWindow) return null;

  try {
    if (browserWindow.name.startsWith(RESUME_TAB_NAME_PREFIX)) {
      return browserWindow.name.slice(RESUME_TAB_NAME_PREFIX.length);
    }

    const tabId = createId();
    browserWindow.name = `${RESUME_TAB_NAME_PREFIX}${tabId}`;
    return tabId;
  } catch {
    return null;
  }
}

function isFresh(createdAt: unknown, ttlMs: number): createdAt is number {
  return (
    typeof createdAt === "number" &&
    Number.isFinite(createdAt) &&
    Date.now() - createdAt <= ttlMs
  );
}

function parsePendingResume(value: unknown): PendingConnectorResume | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<PendingConnectorResume>;
  const platform = normalizeIntegrationPlatform(payload.platform);
  const createdAt = payload.createdAt;

  if (
    typeof payload.id !== "string" ||
    typeof payload.chatId !== "string" ||
    !payload.chatId ||
    !platform ||
    !isFresh(createdAt, PENDING_TTL_MS)
  ) {
    return null;
  }

  return {
    id: payload.id,
    chatId: payload.chatId,
    platform,
    reason: typeof payload.reason === "string" ? payload.reason : undefined,
    returnTo:
      typeof payload.returnTo === "string" ? payload.returnTo : undefined,
    sourceTabId:
      typeof payload.sourceTabId === "string" ? payload.sourceTabId : undefined,
    createdAt,
  };
}

function readPendingResumeMap() {
  const rawMap =
    safeReadJson<Record<string, unknown>>(PENDING_RESUME_MAP_KEY) ?? {};
  const pendingById: Record<string, PendingConnectorResume> = {};
  let changed = false;

  for (const [id, value] of Object.entries(rawMap)) {
    const pending = parsePendingResume(value);
    if (!pending || pending.id !== id) {
      changed = true;
      continue;
    }
    pendingById[id] = pending;
  }

  if (changed) {
    safeWriteJson(PENDING_RESUME_MAP_KEY, pendingById);
  }

  return pendingById;
}

function writePendingResumeMap(
  pendingById: Record<string, PendingConnectorResume>,
) {
  safeWriteJson(PENDING_RESUME_MAP_KEY, pendingById);
}

function removePendingResume(id: string) {
  const pendingById = readPendingResumeMap();
  if (pendingById[id]) {
    delete pendingById[id];
    writePendingResumeMap(pendingById);
  }

  const legacyPending = parsePendingResume(
    safeReadJson<PendingConnectorResume>(PENDING_RESUME_KEY),
  );
  if (legacyPending?.id === id) {
    safeRemove(PENDING_RESUME_KEY);
  }
}

function readLegacyPendingResume() {
  const pending = parsePendingResume(
    safeReadJson<PendingConnectorResume>(PENDING_RESUME_KEY),
  );
  if (!pending) {
    safeRemove(PENDING_RESUME_KEY);
    return null;
  }
  return pending;
}

function isPendingForCurrentTab(pending: PendingConnectorResume) {
  if (!pending.sourceTabId) return true;
  return pending.sourceTabId === getConnectorResumeTabId();
}

function parseAuthorizationResult(
  value: unknown,
): ConnectorAuthorizationResult | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<ConnectorAuthorizationResult>;
  const platform = normalizeIntegrationPlatform(payload.platform);
  const status = payload.status;
  const createdAt = payload.createdAt;

  if (
    typeof payload.id !== "string" ||
    !platform ||
    (status !== "success" && status !== "error" && status !== "cancelled") ||
    !isFresh(createdAt, RESULT_TTL_MS)
  ) {
    return null;
  }

  return {
    id: payload.id,
    pendingId:
      typeof payload.pendingId === "string" ? payload.pendingId : undefined,
    platform,
    status,
    error: typeof payload.error === "string" ? payload.error : undefined,
    createdAt,
  };
}

export function createPendingConnectorResume(input: {
  chatId: string;
  platform: IntegrationId;
  reason?: string;
  returnTo?: string;
}) {
  const pending: PendingConnectorResume = {
    id: createId(),
    chatId: input.chatId,
    platform: input.platform,
    reason: input.reason,
    returnTo: input.returnTo,
    sourceTabId: getConnectorResumeTabId() ?? undefined,
    createdAt: Date.now(),
  };
  const pendingById = readPendingResumeMap();
  for (const [pendingId, existingPending] of Object.entries(pendingById)) {
    if (
      existingPending.platform === pending.platform &&
      existingPending.sourceTabId === pending.sourceTabId
    ) {
      delete pendingById[pendingId];
    }
  }
  pendingById[pending.id] = pending;
  writePendingResumeMap(pendingById);
  return pending;
}

export function readPendingConnectorResume(
  platform?: IntegrationId,
  options: { id?: string; requireCurrentTab?: boolean } = {},
) {
  const pendingById = readPendingResumeMap();

  if (options.id) {
    const pending = pendingById[options.id] ?? readLegacyPendingResume();
    if (!pending || pending.id !== options.id) return null;
    if (platform && pending.platform !== platform) return null;
    if (options.requireCurrentTab && !isPendingForCurrentTab(pending)) {
      return null;
    }
    return pending;
  }

  const pendingList = Object.values(pendingById)
    .filter((pending) => !platform || pending.platform === platform)
    .filter(
      (pending) =>
        !options.requireCurrentTab || isPendingForCurrentTab(pending),
    )
    .sort((a, b) => b.createdAt - a.createdAt);

  if (pendingList.length > 0) return pendingList[0];

  const legacyPending = readLegacyPendingResume();
  if (!legacyPending) return null;
  if (platform && legacyPending.platform !== platform) return null;
  if (options.requireCurrentTab && !isPendingForCurrentTab(legacyPending)) {
    return null;
  }
  return legacyPending;
}

export function consumePendingConnectorResume(
  platform?: IntegrationId,
  options: { id?: string; requireCurrentTab?: boolean } = {},
) {
  const pending = readPendingConnectorResume(platform, options);
  if (!pending) return null;
  if (options.requireCurrentTab && !isPendingForCurrentTab(pending)) {
    return null;
  }
  removePendingResume(pending.id);
  return pending;
}

export function clearPendingConnectorResume(id?: string) {
  if (!id) {
    const pendingById = readPendingResumeMap();
    let changed = false;
    for (const [pendingId, pending] of Object.entries(pendingById)) {
      if (isPendingForCurrentTab(pending)) {
        delete pendingById[pendingId];
        changed = true;
      }
    }
    if (changed) {
      writePendingResumeMap(pendingById);
    }

    const legacyPending = readLegacyPendingResume();
    if (!legacyPending || isPendingForCurrentTab(legacyPending)) {
      safeRemove(PENDING_RESUME_KEY);
    }
    return;
  }

  const pending = readPendingConnectorResume(undefined, { id });
  if (pending?.id === id && isPendingForCurrentTab(pending)) {
    removePendingResume(id);
  }
}

export function clearPendingConnectorResumeForPlatform(
  platform: IntegrationId,
) {
  const pendingById = readPendingResumeMap();
  let changed = false;
  for (const [pendingId, pending] of Object.entries(pendingById)) {
    if (pending.platform === platform && isPendingForCurrentTab(pending)) {
      delete pendingById[pendingId];
      changed = true;
    }
  }
  if (changed) {
    writePendingResumeMap(pendingById);
  }

  const legacyPending = readLegacyPendingResume();
  if (
    legacyPending?.platform === platform &&
    isPendingForCurrentTab(legacyPending)
  ) {
    safeRemove(PENDING_RESUME_KEY);
  }
}

export function recordConnectorAuthorizationResult(input: {
  pendingId?: string;
  platform: IntegrationId;
  status: "success" | "error" | "cancelled";
  error?: string;
}) {
  const browserWindow = getBrowserWindow();
  const result: ConnectorAuthorizationResult = {
    id: createId(),
    pendingId: input.pendingId,
    platform: input.platform,
    status: input.status,
    error: input.error,
    createdAt: Date.now(),
  };

  safeWriteJson(AUTHORIZATION_RESULT_KEY, result);

  if (!browserWindow) return result;

  browserWindow.dispatchEvent(
    new CustomEvent(CONNECTOR_AUTHORIZATION_RESULT_EVENT, {
      detail: result,
    }),
  );

  try {
    browserWindow.opener?.postMessage(
      {
        type: CONNECTOR_AUTHORIZATION_RESULT_EVENT,
        payload: result,
      },
      browserWindow.location.origin,
    );
  } catch {
    // Ignore cross-window notification failures.
  }

  return result;
}

export function recordConnectorAuthorizationResultForPending(input: {
  pendingId: string | undefined;
  platform: IntegrationId;
  status: "success" | "error" | "cancelled";
  error?: string;
}) {
  if (!input.pendingId) return null;

  const pending = readPendingConnectorResume(input.platform, {
    id: input.pendingId,
  });
  if (pending?.id !== input.pendingId) return null;

  return recordConnectorAuthorizationResult(input);
}

export function readConnectorAuthorizationResult() {
  const result = parseAuthorizationResult(
    safeReadJson<ConnectorAuthorizationResult>(AUTHORIZATION_RESULT_KEY),
  );

  if (!result) {
    safeRemove(AUTHORIZATION_RESULT_KEY);
    return null;
  }

  return result;
}

export function clearConnectorAuthorizationResult(id?: string) {
  if (!id) {
    safeRemove(AUTHORIZATION_RESULT_KEY);
    return;
  }

  const result = readConnectorAuthorizationResult();
  if (result?.id === id) safeRemove(AUTHORIZATION_RESULT_KEY);
}

export function subscribeConnectorAuthorizationResults(
  handler: (result: ConnectorAuthorizationResult) => void,
) {
  const browserWindow = getBrowserWindow();
  if (!browserWindow) return () => {};

  const handleCustomEvent = (event: Event) => {
    const result = parseAuthorizationResult((event as CustomEvent).detail);
    if (result) handler(result);
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== AUTHORIZATION_RESULT_KEY || !event.newValue) return;
    try {
      const result = parseAuthorizationResult(JSON.parse(event.newValue));
      if (result) handler(result);
    } catch {
      // Ignore malformed cross-tab payloads.
    }
  };

  const handleMessage = (event: MessageEvent) => {
    if (event.origin !== browserWindow.location.origin) return;
    const data = event.data as {
      type?: unknown;
      payload?: unknown;
    };
    if (data?.type !== CONNECTOR_AUTHORIZATION_RESULT_EVENT) return;
    const result = parseAuthorizationResult(data.payload);
    if (result) handler(result);
  };

  browserWindow.addEventListener(
    CONNECTOR_AUTHORIZATION_RESULT_EVENT,
    handleCustomEvent,
  );
  browserWindow.addEventListener("storage", handleStorage);
  browserWindow.addEventListener("message", handleMessage);

  return () => {
    browserWindow.removeEventListener(
      CONNECTOR_AUTHORIZATION_RESULT_EVENT,
      handleCustomEvent,
    );
    browserWindow.removeEventListener("storage", handleStorage);
    browserWindow.removeEventListener("message", handleMessage);
  };
}
