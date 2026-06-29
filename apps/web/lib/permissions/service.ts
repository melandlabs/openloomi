import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/tauri";
import {
  PERMISSION_REGISTRY,
  type GrantAction,
  type PermissionStatus,
  type PermissionWithStatus,
  type SettingsPane,
} from "./registry";

interface RustPermissionState {
  id: string;
  granted: boolean;
}

let cachedPermissions: PermissionWithStatus[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000;

function isCacheValid(): boolean {
  return (
    cachedPermissions !== null && Date.now() - cacheTimestamp < CACHE_TTL_MS
  );
}

export function invalidatePermissionCache(): void {
  cachedPermissions = null;
  cacheTimestamp = 0;
}

async function fetchSystemPermissions(): Promise<
  Map<string, PermissionStatus>
> {
  if (!isTauri()) {
    return new Map();
  }

  try {
    const states = await invoke<RustPermissionState[]>(
      "check_system_permissions",
    );
    const map = new Map<string, PermissionStatus>();
    for (const state of states) {
      map.set(state.id, state.granted ? "granted" : "denied");
    }
    return map;
  } catch (error) {
    console.error("Failed to check system permissions:", error);
    return new Map();
  }
}

export async function getPermissions(
  forceRefresh = false,
): Promise<PermissionWithStatus[]> {
  if (!forceRefresh && isCacheValid() && cachedPermissions) {
    return cachedPermissions;
  }

  const statusMap = await fetchSystemPermissions();

  const permissions: PermissionWithStatus[] = PERMISSION_REGISTRY.map(
    (def) => ({
      ...def,
      status: statusMap.get(def.id) ?? ("unknown" as PermissionStatus),
    }),
  );

  cachedPermissions = permissions;
  cacheTimestamp = Date.now();

  return permissions;
}

export type { SettingsPane };

export async function openSystemSettings(pane: SettingsPane): Promise<void> {
  if (!isTauri()) {
    return;
  }
  try {
    await invoke("open_system_settings", { pane });
  } catch (error) {
    console.warn(`openSystemSettings("${pane}") failed:`, error);
  }
}

export async function requestFolderAccess(folder: string): Promise<boolean> {
  if (!isTauri()) {
    return false;
  }
  try {
    return await invoke<boolean>("request_folder_access", { folder });
  } catch (error) {
    console.error("Failed to request folder access:", error);
    return false;
  }
}

export async function refreshAndGetPermission(
  id: string,
): Promise<PermissionWithStatus | undefined> {
  const permissions = await getPermissions(true);
  return permissions.find((p) => p.id === id);
}

const SCREEN_RECORDING_PERMISSION_ID = "macos:screen-recording";
const SYSTEM_AUDIO_PERMISSION_ID = "macos:system-audio";
const ACCESSIBILITY_PERMISSION_ID = "macos:accessibility";
const MICROPHONE_PERMISSION_ID = "macos:microphone";
const NOTIFICATION_PERMISSION_ID = "macos:notifications";

export type ChroniclePermissionBlockReason =
  | "screen-recording"
  | "accessibility";

/** Whether screen recording is granted (always true outside Tauri). */
export async function isScreenRecordingGranted(
  forceRefresh = false,
): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  const permissions = await getPermissions(forceRefresh);
  const perm = permissions.find((p) => p.id === SCREEN_RECORDING_PERMISSION_ID);
  return perm?.status === "granted";
}

/**
 * Trigger the macOS screen-recording consent dialog from the main app process.
 * This registers the app in System Settings and returns true when the user allows.
 */
export async function requestScreenRecordingAccess(): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  try {
    invalidatePermissionCache();
    const granted = await invoke<boolean>("request_screen_recording_access");
    invalidatePermissionCache();
    return granted;
  } catch (error) {
    console.error("Failed to request screen recording access:", error);
    return false;
  }
}

/** Open Screen Recording settings (fallback after the app is already in the list). */
export async function openScreenRecordingSettings(): Promise<void> {
  invalidatePermissionCache();
  await openSystemSettings("Privacy_ScreenCapture");
}

/** Whether Accessibility is granted (always true outside Tauri). */
export async function isAccessibilityGranted(
  forceRefresh = false,
): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  const permissions = await getPermissions(forceRefresh);
  const perm = permissions.find((p) => p.id === ACCESSIBILITY_PERMISSION_ID);
  return perm?.status === "granted";
}

/** Trigger the macOS Accessibility consent prompt from the main app process. */
export async function requestAccessibilityAccess(): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  try {
    invalidatePermissionCache();
    const granted = await invoke<boolean>("request_accessibility_access");
    invalidatePermissionCache();
    return granted;
  } catch (error) {
    console.error("Failed to request accessibility access:", error);
    return false;
  }
}

/** Open Accessibility settings (fallback when the user must toggle manually). */
export async function openAccessibilitySettings(): Promise<void> {
  invalidatePermissionCache();
  await openSystemSettings("Privacy_Accessibility");
}

/** Whether microphone is granted (always true outside Tauri). */
export async function isMicrophoneGranted(
  forceRefresh = false,
): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  const permissions = await getPermissions(forceRefresh);
  const perm = permissions.find((p) => p.id === MICROPHONE_PERMISSION_ID);
  return perm?.status === "granted";
}

/**
 * Trigger the macOS microphone consent dialog from the main app process.
 */
export async function requestMicrophoneAccess(): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  try {
    invalidatePermissionCache();
    const granted = await invoke<boolean>("request_microphone_access");
    invalidatePermissionCache();
    return granted;
  } catch (error) {
    console.error("Failed to request microphone access:", error);
    return false;
  }
}

/** Open Microphone settings (fallback when the user must toggle manually). */
export async function openMicrophoneSettings(): Promise<void> {
  invalidatePermissionCache();
  await openSystemSettings("Privacy_Microphone");
}

/** Whether system audio recording is granted (always true outside Tauri). */
export async function isSystemAudioGranted(
  forceRefresh = false,
): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  const permissions = await getPermissions(forceRefresh);
  const perm = permissions.find((p) => p.id === SYSTEM_AUDIO_PERMISSION_ID);
  return perm?.status === "granted";
}

/**
 * Ensure system-audio permission before native capture.
 * Requests consent when needed, then re-probes TCC (which can lag briefly after grant).
 */
export async function ensureSystemAudioAccess(): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  if (await isSystemAudioGranted(true)) {
    return true;
  }

  invalidatePermissionCache();
  await requestSystemAudioAccess();

  for (let attempt = 0; attempt < 6; attempt++) {
    invalidatePermissionCache();
    if (await isSystemAudioGranted(true)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return isSystemAudioGranted(true);
}

/**
 * Trigger the macOS system-audio consent dialog (System Audio only).
 * Uses kTCCServiceAudioCapture — separate from screen recording permission.
 */
export async function requestSystemAudioAccess(): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  try {
    invalidatePermissionCache();
    const granted = await invoke<boolean>("request_system_audio_access");
    invalidatePermissionCache();
    return granted;
  } catch (error) {
    console.error("Failed to request system audio access:", error);
    return false;
  }
}

/** Open System Audio settings (opens Privacy_ScreenCapture). */
export async function openSystemAudioSettings(): Promise<void> {
  invalidatePermissionCache();
  await openSystemSettings("Privacy_ScreenCapture");
}

/** Whether notification is granted (always true outside Tauri). */
export async function isNotificationGranted(
  forceRefresh = false,
): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  const permissions = await getPermissions(forceRefresh);
  const perm = permissions.find((p) => p.id === NOTIFICATION_PERMISSION_ID);
  return perm?.status === "granted";
}

/**
 * Trigger the macOS notification consent dialog from the main app process.
 */
export async function requestNotificationAccess(): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  try {
    invalidatePermissionCache();
    const granted = await invoke<boolean>("request_notification_access");
    invalidatePermissionCache();
    return granted;
  } catch (error) {
    console.error("Failed to request notification access:", error);
    return false;
  }
}

/** Open Notification settings (fallback when the user must toggle manually). */
export async function openNotificationSettings(): Promise<void> {
  invalidatePermissionCache();
  await openSystemSettings("Privacy_Notifications");
}

/**
 * Execute a permission registry {@link GrantAction} — the single dispatcher
 * shared by the settings UI and the onboarding capability-authorization flow.
 *
 * For "request-*" actions it triggers the native consent prompt and falls back
 * to the relevant System Settings pane when the user declines. Returns whether
 * the permission ended up granted (best-effort; "macos-settings" returns false
 * because the result is only known after a later re-check). Non-permission
 * grant kinds (oauth/in-app-toggle/external-url) are handled by their own flows
 * and are no-ops here.
 */
export async function runGrantAction(
  grantAction: GrantAction,
  options?: { openSettings?: (pane: SettingsPane) => void | Promise<void> },
): Promise<boolean> {
  const openSettings = options?.openSettings ?? openSystemSettings;

  switch (grantAction.type) {
    case "request-screen-recording": {
      const granted = await requestScreenRecordingAccess();
      invalidatePermissionCache();
      if (!granted) await openScreenRecordingSettings();
      return granted;
    }
    case "request-accessibility": {
      const granted = await requestAccessibilityAccess();
      invalidatePermissionCache();
      if (!granted) await openAccessibilitySettings();
      return granted;
    }
    case "request-microphone": {
      const granted = await requestMicrophoneAccess();
      invalidatePermissionCache();
      if (!granted) await openMicrophoneSettings();
      return granted;
    }
    case "request-system-audio": {
      const granted = await requestSystemAudioAccess();
      invalidatePermissionCache();
      if (!granted) await openSystemAudioSettings();
      return granted;
    }
    case "request-notifications": {
      const granted = await requestNotificationAccess();
      invalidatePermissionCache();
      if (!granted) await openNotificationSettings();
      return granted;
    }
    case "request-folder": {
      const granted = await requestFolderAccess(grantAction.folder);
      invalidatePermissionCache();
      if (!granted) await openSettings("Privacy_FilesAndFolders");
      return granted;
    }
    case "macos-settings": {
      await openSettings(grantAction.pane);
      return false;
    }
    case "external-url": {
      if (typeof window !== "undefined") {
        window.open(grantAction.url, "_blank", "noopener,noreferrer");
      }
      return false;
    }
    case "oauth":
    case "in-app-toggle":
      // Connector OAuth and in-app toggles are driven by their own subsystems.
      return false;
  }
}

async function ensureScreenRecordingForChronicle(): Promise<boolean> {
  let granted = await isScreenRecordingGranted(true);
  if (granted) {
    return true;
  }
  granted = await requestScreenRecordingAccess();
  if (!granted) {
    granted = await isScreenRecordingGranted(true);
  }
  return granted;
}

async function ensureAccessibilityForChronicle(): Promise<boolean> {
  let granted = await isAccessibilityGranted(true);
  if (granted) {
    return true;
  }
  granted = await requestAccessibilityAccess();
  if (!granted) {
    granted = await isAccessibilityGranted(true);
  }
  return granted;
}

/** Whether Chronicle has the macOS permissions it needs (always true outside Tauri). */
export async function areChroniclePermissionsGranted(
  forceRefresh = false,
): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  const [screen, accessibility] = await Promise.all([
    isScreenRecordingGranted(forceRefresh),
    isAccessibilityGranted(forceRefresh),
  ]);
  return screen && accessibility;
}

/** Persist `chronicleEnabled: false` when system permissions were revoked. */
export async function persistChronicleDisabled(): Promise<boolean> {
  try {
    const response = await fetch("/api/preferences/insight", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chronicleEnabled: false }),
    });
    return response.ok;
  } catch (error) {
    console.error("[Chronicle] Failed to persist disabled state:", error);
    return false;
  }
}

/** Mark or clear the one-shot boot retry flag after a permission-blocked enable. */
export async function persistChronicleBootCheck(
  value: boolean,
): Promise<boolean> {
  try {
    const response = await fetch("/api/preferences/insight", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chronicleBootCheck: value }),
    });
    return response.ok;
  } catch (error) {
    console.error("[Chronicle] Failed to persist boot check flag:", error);
    return false;
  }
}

/** Enable Chronicle in preferences (used after boot-time permission retry). */
export async function persistChronicleEnabled(
  enabled: boolean,
): Promise<boolean> {
  try {
    const response = await fetch("/api/preferences/insight", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chronicleEnabled: enabled }),
    });
    return response.ok;
  } catch (error) {
    console.error("[Chronicle] Failed to persist enabled state:", error);
    return false;
  }
}

/**
 * Screen memory needs screen recording (capture) and accessibility (global shortcut).
 * Requests each permission via the system prompt when missing.
 */
export async function ensureChronicleEnablePermissions(): Promise<
  { ready: true } | { ready: false; reason: ChroniclePermissionBlockReason }
> {
  if (!isTauri()) {
    return { ready: true };
  }

  if (!(await ensureScreenRecordingForChronicle())) {
    return { ready: false, reason: "screen-recording" };
  }
  if (!(await ensureAccessibilityForChronicle())) {
    return { ready: false, reason: "accessibility" };
  }
  return { ready: true };
}
