"use client";

import { AutomationTab } from "@/components/automation/automation-tab";
import { AgentTab } from "@/components/automation/agent-tab";
import { SkillsTab } from "@/components/automation/skills-tab";
import { AutomationTabsList } from "@/components/automation/tabs-list";
import type { ScheduledJobsPanelRef } from "@/components/scheduled-jobs-panel";
import type { AgentTabRef } from "@/components/automation/agent-tab";
import { PageSectionHeader } from "@openloomi/ui";
import { Button, Input, Tabs, TabsContent } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@openloomi/ui";
import { AddSkillDropdown } from "@/components/skills-panel";
import type { AddSkillDropdownProps } from "@/components/skills-panel";
import { useTranslation } from "react-i18next";
import { isTauri } from "@/lib/tauri";
import { useEffect, useRef, useState } from "react";
import type { ScheduledJobsStatusFilter } from "@/components/scheduled-jobs-panel";

/**
 * Determines whether the desktop environment agent mode is currently enabled (for browser-side debugging).
 * Supports forcing it on in the browser via URL query `forceTauri=1|true|yes`.
 */
function isTauriEnvEnabled(): boolean {
  if (typeof window !== "undefined") {
    const forceTauri = new URLSearchParams(window.location.search)
      .get("forceTauri")
      ?.toLowerCase();
    if (forceTauri === "1" || forceTauri === "true" || forceTauri === "yes") {
      return true;
    }
  }

  return isTauri() || process.env.NEXT_PUBLIC_FORCE_WEB_AGENT_DEBUG === "true";
}

/**
 * Automation page: three tabs (Agent, Automation, Skills)
 * Display all panels in Tauri environment, show hint text in non-Tauri
 */
export default function ScheduledJobsPage() {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState("automation");
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [jobSearchQuery, setJobSearchQuery] = useState("");
  const [jobStatusFilter, setJobStatusFilter] =
    useState<ScheduledJobsStatusFilter>("all");
  const [addSkillProps, setAddSkillProps] =
    useState<AddSkillDropdownProps | null>(null);
  const panelRef = useRef<ScheduledJobsPanelRef>(null);
  const agentTabRef = useRef<AgentTabRef>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const tauriEnv = mounted && isTauriEnvEnabled();

  if (!mounted) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-muted-foreground">
        <p className="text-sm">{t("common.loading", "Loading...")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      {!tauriEnv ? (
        <>
          <PageSectionHeader title={t("nav.agent", "Agent")} />
          <div className="flex flex-col gap-4 p-4">
            <p className="text-muted-foreground">
              {t(
                "agent.panels.scheduledJobsPanel.tauriOnly",
                "Scheduled jobs are only available in the openloomi desktop app.",
              )}
            </p>
          </div>
        </>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 min-h-0 flex flex-col"
        >
          <PageSectionHeader title={t("nav.agent", "Agent")}>
            <AutomationTabsList
              value={activeTab}
              onValueChange={setActiveTab}
            />
          </PageSectionHeader>

          {/* Second row: reference library, automation for new task, skills for search */}
          {(activeTab === "automation" || activeTab === "skills") && (
            <div className="shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 px-6 py-2">
              {activeTab === "automation" && (
                <div className="flex w-full sm:w-auto sm:ml-auto items-center gap-2">
                  <div className="relative w-full min-w-[160px] sm:w-56">
                    <RemixIcon
                      name="search"
                      size="size-4"
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <Input
                      placeholder={t(
                        "agent.panels.scheduledJobsPanel.searchPlaceholder",
                        "Search tasks",
                      )}
                      value={jobSearchQuery}
                      onChange={(e) => setJobSearchQuery(e.target.value)}
                      className="pl-8 h-9 text-sm bg-muted/50 border border-border/60 rounded-md"
                    />
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className={`h-9 w-9 ${
                          jobStatusFilter !== "all"
                            ? "bg-primary/10 border-primary/20"
                            : ""
                        }`}
                        aria-label={t(
                          "agent.panels.scheduledJobsPanel.filterTitle",
                          "Filter",
                        )}
                      >
                        <RemixIcon name="filter" size="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuLabel>
                        {t(
                          "agent.panels.scheduledJobsPanel.filterTitle",
                          "Filter",
                        )}
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={jobStatusFilter}
                        onValueChange={(value) => {
                          setJobStatusFilter(
                            value as ScheduledJobsStatusFilter,
                          );
                        }}
                      >
                        <DropdownMenuRadioItem
                          value="all"
                          className="cursor-pointer"
                        >
                          {t(
                            "agent.panels.scheduledJobsPanel.filterAll",
                            "All",
                          )}
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem
                          value="not_executed"
                          className="cursor-pointer"
                        >
                          {t(
                            "agent.panels.scheduledJobsPanel.filterNotExecuted",
                            "Not executed",
                          )}
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem
                          value="executed"
                          className="cursor-pointer"
                        >
                          {t(
                            "agent.panels.scheduledJobsPanel.filterExecuted",
                            "Executed",
                          )}
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    size="sm"
                    onClick={() => panelRef.current?.openCreateDialog?.()}
                  >
                    <RemixIcon name="add" className="mr-1.5 size-4" />
                    {t("agent.panels.scheduledJobsPanel.newTask", "New Task")}
                  </Button>
                </div>
              )}
              {activeTab === "skills" && (
                <div className="flex w-full sm:w-auto flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 sm:ml-auto sm:justify-end">
                  <div className="relative w-full min-w-[120px] sm:w-48">
                    <RemixIcon
                      name="search"
                      size="size-4"
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <Input
                      placeholder={t(
                        "agent.panels.skills.searchPlaceholder",
                        "Search skills",
                      )}
                      value={skillSearchQuery}
                      onChange={(e) => setSkillSearchQuery(e.target.value)}
                      className="pl-8 h-9 text-sm bg-muted/50 border border-border/60 rounded-md"
                    />
                  </div>
                  {addSkillProps && (
                    <AddSkillDropdown
                      onOpenLocalFolder={addSkillProps.onOpenLocalFolder}
                      onCreateSkill={addSkillProps.onCreateSkill}
                      openingFolder={addSkillProps.openingFolder}
                      disabled={addSkillProps.disabled}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex-1 min-h-0 px-6 pt-3 pb-3">
            <TabsContent
              value="agent"
              className="mt-0 h-full data-[state=active]:flex data-[state=active]:flex-col"
            >
              <AgentTab ref={agentTabRef} />
            </TabsContent>

            <TabsContent
              value="automation"
              className="mt-0 h-full data-[state=active]:flex data-[state=active]:flex-col"
            >
              <AutomationTab
                ref={panelRef}
                statusFilter={jobStatusFilter}
                searchQuery={jobSearchQuery}
              />
            </TabsContent>

            <TabsContent
              value="skills"
              className="mt-0 h-full data-[state=active]:flex data-[state=active]:flex-col"
            >
              <SkillsTab
                searchQuery={skillSearchQuery}
                onAddSkillProps={setAddSkillProps}
              />
            </TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  );
}
