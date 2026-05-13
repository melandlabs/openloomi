"use client";

import { SkillsPanel } from "@/components/skills-panel";
import type { AddSkillDropdownProps } from "@/components/skills-panel";
import { isTauri } from "@/lib/tauri";
import { useState, useEffect, useMemo, useCallback } from "react";

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
}

interface SkillsTabProps {
  /** Search keyword, used to filter the skills list by name and description */
  searchQuery?: string;
  /** Passes the "Add Skill" dropdown props to the parent component for rendering on the second header row */
  onAddSkillProps?: (props: AddSkillDropdownProps) => void;
}

/**
 * Skills tab: loads the skills list and supports filtering by searchQuery before passing to SkillsPanel.
 */
export function SkillsTab({
  searchQuery = "",
  onAddSkillProps,
}: SkillsTabProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [directories, setDirectories] = useState<{
    agent: string;
    openloomi: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [openingFolder, setOpeningFolder] = useState(false);

  const q = (searchQuery ?? "").trim().toLowerCase();
  const filteredSkills = useMemo(() => {
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q),
    );
  }, [skills, q]);

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/workspace/skills");
      const data = await response.json();
      if (data.success) {
        setSkills(data.skills ?? []);
        setDirectories(data.directories ?? null);
      }
    } catch (err) {
      console.error("[SkillsTab] Failed to load skills:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenLocalFolder = useCallback(async () => {
    if (!directories?.openloomi) return;
    setOpeningFolder(true);
    try {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(directories.openloomi);
    } catch (e) {
      console.error("[SkillsTab] Open folder failed:", e);
    } finally {
      setOpeningFolder(false);
    }
  }, [directories?.openloomi]);

  const handleCreateSkill = useCallback(() => {
    const newChatId = crypto.randomUUID();
    window.location.href = `/?page=chat&chatId=${encodeURIComponent(
      newChatId,
    )}&input=/skill-creator`;
  }, []);

  useEffect(() => {
    if (!onAddSkillProps) return;
    onAddSkillProps({
      onOpenLocalFolder: handleOpenLocalFolder,
      onCreateSkill: handleCreateSkill,
      openingFolder,
      disabled: !directories?.openloomi || !isTauri(),
    });
  }, [
    onAddSkillProps,
    handleOpenLocalFolder,
    handleCreateSkill,
    openingFolder,
    directories?.openloomi,
  ]);

  return (
    <SkillsPanel
      className="flex-1"
      skills={filteredSkills}
      directories={directories}
      isLoading={isLoading}
      onRefresh={loadSkills}
      onOpenLocalFolder={handleOpenLocalFolder}
      onCreateSkill={handleCreateSkill}
      openingFolder={openingFolder}
      hideEmptyStateAddSkill
    />
  );
}
