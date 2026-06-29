export type PermissionType =
  | "macos-tcc"
  | "integration"
  | "agent-tool"
  | "connector";

export type PermissionStatus =
  | "granted"
  | "denied"
  | "not-determined"
  | "unknown";

export type SettingsPane =
  | "Privacy_AllFiles"
  | "Privacy_ScreenCapture"
  | "Privacy_Accessibility"
  | "Privacy_FilesAndFolders"
  | "Privacy_Microphone"
  | "Privacy_Notifications"
  | "Notifications";

export type GrantAction =
  | { type: "macos-settings"; pane: SettingsPane }
  | { type: "request-screen-recording" }
  | { type: "request-accessibility" }
  | { type: "request-microphone" }
  | { type: "request-system-audio" }
  | { type: "request-notifications" }
  | { type: "request-folder"; folder: string }
  | { type: "oauth"; platform: string }
  | { type: "in-app-toggle" }
  | { type: "external-url"; url: string };

export interface PermissionDefinition {
  id: string;
  type: PermissionType;
  displayNameKey: string;
  descriptionKey: string;
  icon: string;
  grantAction: GrantAction;
  priority: "core" | "recommended" | "optional";
  requiredByKeys?: string[];
}

export interface PermissionWithStatus extends PermissionDefinition {
  status: PermissionStatus;
}

export const PERMISSION_REGISTRY: PermissionDefinition[] = [
  {
    id: "macos:full-disk-access",
    type: "macos-tcc",
    displayNameKey: "permissions.fullDiskAccess.name",
    descriptionKey: "permissions.fullDiskAccess.desc",
    icon: "hard_drive_3",
    grantAction: { type: "macos-settings", pane: "Privacy_AllFiles" },
    priority: "core",
    requiredByKeys: [
      "permissions.requiredBy.imessage",
      "permissions.requiredBy.fileSearch",
    ],
  },
  {
    id: "macos:downloads",
    type: "macos-tcc",
    displayNameKey: "permissions.downloads.name",
    descriptionKey: "permissions.downloads.desc",
    icon: "download_2",
    grantAction: { type: "request-folder", folder: "Downloads" },
    priority: "recommended",
    requiredByKeys: [
      "permissions.requiredBy.dailyReport",
      "permissions.requiredBy.fileDownload",
    ],
  },
  {
    id: "macos:documents",
    type: "macos-tcc",
    displayNameKey: "permissions.documents.name",
    descriptionKey: "permissions.documents.desc",
    icon: "file_text",
    grantAction: { type: "request-folder", folder: "Documents" },
    priority: "recommended",
    requiredByKeys: ["permissions.requiredBy.docAccess"],
  },
  {
    id: "macos:desktop",
    type: "macos-tcc",
    displayNameKey: "permissions.desktop.name",
    descriptionKey: "permissions.desktop.desc",
    icon: "computer",
    grantAction: { type: "request-folder", folder: "Desktop" },
    priority: "optional",
    requiredByKeys: ["permissions.requiredBy.desktopAccess"],
  },
  {
    id: "macos:screen-recording",
    type: "macos-tcc",
    displayNameKey: "permissions.screenRecording.name",
    descriptionKey: "permissions.screenRecording.desc",
    icon: "screenshot",
    grantAction: { type: "request-screen-recording" },
    priority: "optional",
    requiredByKeys: ["permissions.requiredBy.chronicle"],
  },
  {
    id: "macos:accessibility",
    type: "macos-tcc",
    displayNameKey: "permissions.accessibility.name",
    descriptionKey: "permissions.accessibility.desc",
    icon: "settings",
    grantAction: { type: "request-accessibility" },
    priority: "optional",
    requiredByKeys: ["permissions.requiredBy.globalShortcut"],
  },
  {
    id: "macos:microphone",
    type: "macos-tcc",
    displayNameKey: "permissions.microphone.name",
    descriptionKey: "permissions.microphone.desc",
    icon: "mic",
    grantAction: { type: "request-microphone" },
    priority: "optional",
    requiredByKeys: ["permissions.requiredBy.voiceInput"],
  },
  {
    id: "macos:system-audio",
    type: "macos-tcc",
    displayNameKey: "permissions.systemAudio.name",
    descriptionKey: "permissions.systemAudio.desc",
    icon: "speaker",
    grantAction: { type: "request-system-audio" },
    priority: "optional",
    requiredByKeys: ["permissions.requiredBy.audioCapture"],
  },
  {
    id: "macos:notifications",
    type: "macos-tcc",
    displayNameKey: "permissions.notifications.name",
    descriptionKey: "permissions.notifications.desc",
    icon: "bell",
    grantAction: { type: "request-notifications" },
    priority: "optional",
    requiredByKeys: ["permissions.requiredBy.notifications"],
  },
];

export function getPermissionById(
  id: string,
): PermissionDefinition | undefined {
  return PERMISSION_REGISTRY.find((p) => p.id === id);
}

export function getPermissionsByPriority(
  priority: PermissionDefinition["priority"],
): PermissionDefinition[] {
  return PERMISSION_REGISTRY.filter((p) => p.priority === priority);
}

export function getMacosTccPermissions(): PermissionDefinition[] {
  return PERMISSION_REGISTRY.filter((p) => p.type === "macos-tcc");
}

/**
 * Whether a permission grants the agent local filesystem access — either a
 * specific folder scope (Downloads/Documents/Desktop) or full-disk access.
 * Callers use this to decide whether the agent already has a local data
 * source to work from, independent of any connector.
 */
export function isFileAccessPermission(
  permission: PermissionDefinition,
): boolean {
  if (permission.grantAction.type === "request-folder") return true;
  // Only `Privacy_AllFiles` (full-disk access) counts here — intentionally not
  // `Privacy_FilesAndFolders`. Per-folder grants are modeled via the
  // `request-folder` action above, not that settings pane (which no permission
  // currently uses). Revisit this if a folder permission is ever defined with a
  // `Privacy_FilesAndFolders` pane instead of a `request-folder` action.
  return (
    permission.grantAction.type === "macos-settings" &&
    permission.grantAction.pane === "Privacy_AllFiles"
  );
}

export function getFileAccessPermissionIds(): string[] {
  return PERMISSION_REGISTRY.filter(isFileAccessPermission).map((p) => p.id);
}
