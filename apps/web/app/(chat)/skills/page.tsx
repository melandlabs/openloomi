"use client";

import { PageSectionHeader } from "@openloomi/ui";
import {
  SkillsPanel,
  AddSkillDropdown,
} from "@/components/skills-panel";
import { useTranslation } from "react-i18next";
import { isTauri } from "@/lib/tauri";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { generateUUID } from "@/lib/utils";
import { toast } from "@/components/toast";
import "../../../i18n";

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

/**
 * Skills standalone page
 * "My Skills" entry moved from personalization, displays SkillsPanel in Tauri environment;
 * "Add skill" merged into dropdown in header (add local skill / create skill)
 */
export default function SkillsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [directories, setDirectories] = useState<{
    agent: string;
    openloomi: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [openingFolder, setOpeningFolder] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadSkills = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/workspace/skills");
      const data = await response.json();
      if (data.success) {
        setSkills(data.skills ?? []);
        setDirectories(data.directories ?? null);
      }
    } catch (err) {
      console.error("[SkillsPage] Failed to load skills:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mounted && isTauri()) {
      loadSkills();
    }
  }, [mounted, loadSkills]);

  const handleOpenLocalFolder = useCallback(async () => {
    if (!isTauri()) return;
    setOpeningFolder(true);
    try {
      const { pickFolderDialog } = await import("@/lib/tauri");
      const selected = await pickFolderDialog();

      if (!selected) {
        setOpeningFolder(false);
        return;
      }

      // Call API to add selected directory to skills directory
      const response = await fetch("/api/workspace/skills/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selected }),
      });

      const data = await response.json();
      if (data.success) {
        toast({
          type: "success",
          description: t(
            "personalization.skillsSettings.addedSkill",
            "Skill added successfully",
          ),
        });
        // Reload skills list
        loadSkills();
      } else {
        toast({
          type: "error",
          description: data.error || t(
            "personalization.skillsSettings.failedToAddSkill",
            "Failed to add skill",
          ),
        });
      }
    } catch (e) {
      console.error("[SkillsPage] Pick folder dialog failed:", e);
      toast({
        type: "error",
        description: t(
          "personalization.skillsSettings.failedToOpenFolder",
          "Failed to open folder",
        ),
      });
    } finally {
      setOpeningFolder(false);
    }
  }, [t, loadSkills]);

  const handleCreateSkill = useCallback(() => {
    const newChatId = generateUUID();
    router.push(
      `/?page=chat&chatId=${encodeURIComponent(newChatId)}&input=/skill-creator`,
    );
  }, [router]);

  const tauriEnv = mounted && isTauri();

  if (!mounted) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-muted-foreground">
        <p className="text-sm">{t("common.loading", "Loading...")}</p>
      </div>
    );
  }

  if (!tauriEnv) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-8">
        <h1 className="text-2xl font-semibold">{t("nav.skills")}</h1>
        <p className="text-muted-foreground">
          {t(
            "agent.panels.workspacePanel.skillsTauriOnly",
            "Skills are only available in the openloomi desktop app.",
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full min-h-[60vh]">
      <PageSectionHeader title={t("nav.skills")}>
        <AddSkillDropdown
          onOpenLocalFolder={handleOpenLocalFolder}
          onCreateSkill={handleCreateSkill}
          openingFolder={openingFolder}
          disabled={!directories?.openloomi || isLoading}
        />
      </PageSectionHeader>
      <SkillsPanel
        className="flex-1"
        skills={skills}
        directories={directories}
        isLoading={isLoading}
        onRefresh={loadSkills}
        onOpenLocalFolder={handleOpenLocalFolder}
        onCreateSkill={handleCreateSkill}
        openingFolder={openingFolder}
      />
    </div>
  );
}
