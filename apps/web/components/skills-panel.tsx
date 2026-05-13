"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { cn, generateUUID } from "@/lib/utils";
import { ScrollArea } from "./ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";
import { toast } from "@/components/toast";
import { isTauri, openPathCustom } from "@/lib/tauri";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { RemixIcon } from "@/components/remix-icon";
import { Switch } from "@openloomi/ui";
import "../i18n";

/** Quick select common emoji list (skill avatars) */
const SKILL_AVATAR_EMOJIS = [
  "🎯",
  "📚",
  "✍️",
  "🖼️",
  "📊",
  "🔧",
  "💡",
  "🚀",
  "📝",
  "🎨",
  "🔍",
  "💼",
  "📧",
  "⏰",
  "👥",
  "✅",
  "📬",
  "🎮",
  "🧩",
  "⚡",
  "🌟",
  "🔬",
  "📱",
  "🛠️",
  "💬",
  "🎵",
];

/** Add skill dropdown menu props (handlers passed from page or panel) */
export interface AddSkillDropdownProps {
  onOpenLocalFolder: () => void;
  onCreateSkill: () => void;
  openingFolder: boolean;
  disabled?: boolean;
}

/**
 * "Add Skill" dropdown: add local skill, create skill
 * Used in page header and empty state, merges original two buttons into single entry
 */
export function AddSkillDropdown({
  onOpenLocalFolder,
  onCreateSkill,
  openingFolder,
  disabled = false,
}: AddSkillDropdownProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="font-sans"
        >
          <RemixIcon name="add" size="size-4" className="mr-1.5" />
          {t("personalization.skillsSettings.addSkill", "Add Skill")}
          <RemixIcon name="arrow_down_s" size="size-4" className="ml-1.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={onOpenLocalFolder}
          disabled={openingFolder || disabled}
        >
          <RemixIcon name="folder_open" size="size-4" className="mr-2" />
          {t("personalization.skillsSettings.addLocalSkill", "Add local skill")}
        </DropdownMenuItem>
        {/* <DropdownMenuItem onClick={onCreateSkill} disabled={disabled}>
          <RemixIcon name="bard" size="size-4" className="mr-2" />
          {t("personalization.skillsSettings.createSkill", "Create skill")}
        </DropdownMenuItem> */}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface Skill {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  argumentHint?: string;
  path: string;
  source?: string;
  avatar?: string;
  enabled?: boolean;
}

interface SkillsPanelProps {
  className?: string;
  /** Controlled mode: data and callbacks passed from page, no internal fetch */
  skills?: Skill[];
  directories?: { agent: string; openloomi: string } | null;
  isLoading?: boolean;
  onRefresh?: () => void;
  onOpenLocalFolder?: () => void;
  onCreateSkill?: () => void;
  openingFolder?: boolean;
  /** When true, empty state doesn't show "Add Skill" button (used when moved to page header second line) */
  hideEmptyStateAddSkill?: boolean;
}

/**
 * Skills list panel: grid card layout, supports loading/empty/error states
 * Supports controlled mode (data and "add skill" callbacks passed from skills page) and internal fetch mode
 */
export function SkillsPanel({
  className,
  skills: controlledSkills,
  directories: controlledDirectories,
  isLoading: controlledLoading,
  onRefresh,
  onOpenLocalFolder,
  onCreateSkill,
  openingFolder: controlledOpeningFolder = false,
  hideEmptyStateAddSkill = false,
}: SkillsPanelProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [internalSkills, setInternalSkills] = useState<Skill[]>([]);
  const [internalDirectories, setInternalDirectories] = useState<{
    agent: string;
    openloomi: string;
  } | null>(null);
  const [internalLoading, setInternalLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [internalOpeningFolder, setInternalOpeningFolder] = useState(false);

  const isControlled =
    controlledSkills !== undefined &&
    onOpenLocalFolder !== undefined &&
    onCreateSkill !== undefined;
  const skills = isControlled
    ? (controlledSkills ?? internalSkills)
    : internalSkills;
  const directories = isControlled
    ? (controlledDirectories ?? null)
    : internalDirectories;
  const isLoading =
    isControlled && controlledLoading !== undefined
      ? controlledLoading
      : internalLoading;
  const openingFolder = isControlled
    ? (controlledOpeningFolder ?? false)
    : internalOpeningFolder;

  const loadSkills = async () => {
    if (isControlled && onRefresh) {
      onRefresh();
      return;
    }
    setInternalLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/workspace/skills");
      const data = await response.json();
      if (data.success) {
        setInternalSkills(data.skills ?? []);
        setInternalDirectories(data.directories ?? null);
      } else {
        setError(data.error || "Failed to load skills");
      }
    } catch (err) {
      console.error("[SkillsPanel] Failed to load skills:", err);
      setError("Failed to load skills");
    } finally {
      setInternalLoading(false);
    }
  };

  useEffect(() => {
    if (isControlled) return;
    loadSkills();
  }, []);

  const handleOpenLocalFolder = async () => {
    if (onOpenLocalFolder) {
      onOpenLocalFolder();
      return;
    }
    if (!internalDirectories?.openloomi || !isTauri()) return;
    setInternalOpeningFolder(true);
    try {
      await openPathCustom(internalDirectories.openloomi);
      toast({
        type: "success",
        description: t(
          "personalization.skillsSettings.openedFolder",
          "Opened skill folder",
        ),
      });
    } catch (e) {
      console.error("[SkillsPanel] Open folder failed:", e);
      toast({
        type: "error",
        description: t(
          "personalization.skillsSettings.failedToOpenFolder",
          "Failed to open folder",
        ),
      });
    } finally {
      setInternalOpeningFolder(false);
    }
  };

  const handleUseSkillCreator = () => {
    if (onCreateSkill) {
      onCreateSkill();
      return;
    }
    const newChatId = generateUUID();
    router.push(
      `/?page=chat&chatId=${encodeURIComponent(newChatId)}&input=/skill-creator`,
    );
  };

  const addSkillDropdown = (disabled = false) => (
    <AddSkillDropdown
      onOpenLocalFolder={handleOpenLocalFolder}
      onCreateSkill={handleUseSkillCreator}
      openingFolder={openingFolder}
      disabled={disabled || !directories?.openloomi || !isTauri()}
    />
  );

  return (
    <div className={cn("flex flex-col h-[100%] min-h-0", className)}>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RemixIcon
                name="loader_2"
                size="size-6"
                className="animate-spin text-muted-foreground"
              />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <RemixIcon
                name="info"
                size="size-8"
                className="text-muted-foreground/50 mb-2"
              />
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          ) : skills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <RemixIcon
                name="apps_2_ai"
                size="size-8"
                className="text-muted-foreground/50 mb-2"
              />
              <p className="text-sm text-muted-foreground">
                {t(
                  "agent.panels.workspacePanel.noSkills",
                  "No skills installed",
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t(
                  "agent.panels.workspacePanel.skillsHint",
                  "Add skills to ~/.openloomi/skills/",
                )}
              </p>
              {!hideEmptyStateAddSkill && (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {addSkillDropdown()}
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 pt-0 pb-6 px-6">
              {skills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  canDelete={
                    !!directories && skill.source === directories.openloomi
                  }
                  canToggle={
                    !!directories && skill.source === directories.openloomi
                  }
                  onAvatarChange={loadSkills}
                  onDeleted={loadSkills}
                  onToggle={loadSkills}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

interface SkillCardProps {
  skill: Skill;
  canDelete?: boolean;
  canToggle?: boolean;
  onAvatarChange?: () => void;
  onDeleted?: () => void;
  onToggle?: () => void;
}

/**
 * Single skill card: avatar on top, name on next line, description multi-line ellipsis; can enable/disable/delete (openloomi skills only)
 */
function SkillCard({
  skill,
  canDelete,
  canToggle,
  onAvatarChange,
  onDeleted,
  onToggle,
}: SkillCardProps) {
  const { t } = useTranslation();
  const [updating, setUpdating] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  const updateAvatar = async (avatar: string | null) => {
    setUpdating(true);
    try {
      const res = await fetch("/api/workspace/skills/metadata", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId: skill.id,
          avatar: avatar ?? "",
        }),
      });
      const data = await res.json();
      if (data.success) onAvatarChange?.();
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/workspace/skills/${encodeURIComponent(skill.id)}`,
        {
          method: "DELETE",
        },
      );
      if (res.ok) {
        setDeleteConfirmOpen(false);
        onDeleted?.();
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleToggle = async () => {
    if (!canToggle) return;
    setToggling(true);
    try {
      const res = await fetch("/api/workspace/skills/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId: skill.id,
          enabled: !skill.enabled,
        }),
      });
      const data = await res.json();
      if (data.success) {
        onToggle?.();
      }
    } finally {
      setToggling(false);
    }
  };

  const isopenloomiSkill = canDelete || canToggle;

  return (
    <div
      className={cn(
        "group bg-card border border-border rounded-lg shadow-sm p-4 min-h-[152px] flex flex-col transition-colors hover:border-foreground/20 relative",
        skill.enabled === false && "opacity-60",
      )}
    >
      {/* ... button: shows on hover, contains Switch and Delete */}
      {isopenloomiSkill && (
        <div className="absolute top-2 right-2 opacity-100 transition-opacity z-[1]">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground p-1.5 rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                aria-label="Skill options"
              >
                <RemixIcon name="more" size="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {/* Switch option */}
              {canToggle && (
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-sm">
                    {skill.enabled
                      ? t(
                          "personalization.skillsSettings.disableSkill",
                          "Disable",
                        )
                      : t(
                          "personalization.skillsSettings.enableSkill",
                          "Enable",
                        )}
                  </span>
                  <Switch
                    checked={skill.enabled ?? true}
                    onCheckedChange={handleToggle}
                    disabled={toggling}
                    className="scale-75"
                  />
                </div>
              )}
              {/* Delete option */}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="text-destructive focus:text-destructive"
                >
                  {t("personalization.skillsSettings.deleteSkill", "Delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {/* Avatar on top */}
      <div className="pr-6 mb-2">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="bg-primary/10 flex size-10 shrink-0 items-center justify-center rounded-full text-xl hover:ring-2 hover:ring-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
              disabled={updating}
              aria-label={t(
                "personalization.skillsSettings.changeAvatar",
                "Change avatar",
              )}
            >
              {skill.avatar ? (
                <span>{skill.avatar}</span>
              ) : (
                <RemixIcon
                  name="apps_2_ai"
                  size="size-5"
                  className="text-primary"
                />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="start">
            <p className="text-xs text-muted-foreground mb-2 px-1">
              {t(
                "personalization.skillsSettings.changeAvatar",
                "Change avatar",
              )}
            </p>
            <div className="grid grid-cols-6 gap-1">
              {SKILL_AVATAR_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="text-lg p-1 rounded hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
                  onClick={() => updateAvatar(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full text-xs"
              onClick={() => updateAvatar(null)}
            >
              {t("personalization.skillsSettings.clearAvatar", "Clear avatar")}
            </Button>
          </PopoverContent>
        </Popover>
      </div>

      {/* Skill name: next line after avatar, single line truncation */}
      <h3 className="text-sm font-semibold font-serif text-foreground truncate mb-2">
        {skill.name}
      </h3>

      {/* Description: fixed line count ellipsis */}
      {skill.description && (
        <p className="text-muted-foreground text-xs leading-relaxed line-clamp-3 flex-1 min-h-[2.25rem]">
          {skill.description}
        </p>
      )}

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("personalization.skillsSettings.deleteSkill", "Delete Skill")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "personalization.skillsSettings.deleteConfirm",
                "Are you sure you want to delete this skill?",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("personalization.skillsSettings.closeModal", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting
                ? t("personalization.skillsSettings.loading", "Loading...")
                : t(
                    "personalization.skillsSettings.deleteSkill",
                    "Delete Skill",
                  )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
