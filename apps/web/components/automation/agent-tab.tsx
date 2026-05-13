"use client";

import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@openloomi/ui";
import { Button, Input } from "@openloomi/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { toast } from "@/components/toast";

export interface AgentTabRef {
  openCreateDialog: () => void;
}

interface Agent {
  id: string;
  name: string;
  description: string | null;
  model: string;
  systemPrompt: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CreateAgentData {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  enabled: boolean;
}

export const AgentTab = forwardRef<AgentTabRef>(function AgentTab(_, ref) {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState<CreateAgentData>({
    name: "",
    description: "",
    model: "claude-sonnet-4.6",
    systemPrompt: "",
    enabled: true,
  });
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedMCPs, setSelectedMCPs] = useState<string[]>([]);
  const [selectedAutomations, setSelectedAutomations] = useState<string[]>([]);

  useImperativeHandle(ref, () => ({
    openCreateDialog: () => {
      resetForm();
    },
  }));

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/agents");
      if (response.ok) {
        const data = await response.json();
        setAgents(data.agents || []);
      }
    } catch (error) {
      console.error("Failed to fetch agents:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  const handleCreateAgent = async () => {
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        toast({
          type: "success",
          description: t(
            "agent.panels.agentPanel.createSuccess",
            "Agent created",
          ),
        });
        resetForm();
        fetchAgents();
      }
    } catch (error) {
      console.error("Failed to create agent:", error);
      toast({
        type: "error",
        description: t(
          "agent.panels.agentPanel.createError",
          "Failed to create agent",
        ),
      });
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      model: "claude-sonnet-4.6",
      systemPrompt: "",
      enabled: true,
    });
    setSelectedSkills([]);
    setSelectedMCPs([]);
    setSelectedAutomations([]);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RemixIcon
          name="loader_2"
          size="size-6"
          className="animate-spin text-muted-foreground"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 h-full relative">
      {/* Main Content Area - Split into center and right */}
      <div className="flex-1 flex">
        {/* Center Chat/Workspace Area */}
        <div className="flex-1 bg-[#F9FAFB] flex flex-col items-center justify-center p-8">
          <div className="text-center max-w-md">
            {agents.length === 0 ? (
              <>
                <div className="mb-6 flex justify-center">
                  <div className="bg-white rounded-full p-4 shadow-sm">
                    <RemixIcon
                      name="robot_2"
                      size="size-16"
                      className="text-primary"
                    />
                  </div>
                </div>
                <h2 className="text-xl font-medium text-[#1F2937] mb-2">
                  {t("agent.panels.agentPanel.emptyTitle", "No agents yet")}
                </h2>
                <p className="text-[#6B7280] mb-6">
                  {t(
                    "agent.panels.agentPanel.emptyMessage",
                    "Tell me how to help you create an agent?",
                  )}
                </p>
              </>
            ) : (
              <>
                <div className="mb-6 flex justify-center">
                  <div className="bg-white rounded-full p-4 shadow-sm">
                    <RemixIcon
                      name="robot_2"
                      size="size-16"
                      className="text-primary"
                    />
                  </div>
                </div>
                <h2 className="text-xl font-medium text-[#1F2937] mb-2">
                  {t(
                    "agent.panels.agentPanel.manageTitle",
                    "Manage your agents",
                  )}
                </h2>
                <p className="text-[#6B7280] mb-6">
                  {t(
                    "agent.panels.agentPanel.selectToEdit",
                    "Select an agent to edit or create a new one",
                  )}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Right Configuration Panel */}
        <div className="w-[400px] border-l border-[#E5E7EB] bg-white p-4">
          <ScrollArea className="h-full">
            <div className="space-y-3 pr-2">
              {/* Name Section */}
              <div className="border border-[#E5E7EB] rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RemixIcon
                      name="text"
                      size="size-4"
                      className="text-[#6B7280]"
                    />
                    <h3 className="font-medium text-[#1F2937] text-sm">
                      {t("agent.panels.agentPanel.name", "Name")}
                    </h3>
                  </div>
                  <div className="w-6 h-6 flex items-center justify-center text-[#9CA3AF]">
                    <RemixIcon name="close" size="size-3" />
                  </div>
                </div>
                <Input
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder={t(
                    "agent.panels.agentPanel.namePlaceholder",
                    "My agent",
                  )}
                  className="bg-white"
                />
              </div>

              {/* Soul Section */}
              <div className="border border-[#E5E7EB] rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <RemixIcon
                    name="emotion_line"
                    size="size-4"
                    className="text-[#6B7280]"
                  />
                  <h3 className="font-medium text-[#1F2937] text-sm">
                    {t("agent.panels.agentPanel.description", "Description")}
                  </h3>
                </div>
                <div className="space-y-2">
                  {[
                    { key: "creative", label: "Creative" },
                    { key: "analytical", label: "Analytical" },
                    { key: "friendly", label: "Friendly" },
                    { key: "professional", label: "Professional" },
                    { key: "calm", label: "Calm" },
                    { key: "energetic", label: "Energetic" },
                  ].map((trait) => (
                    <button
                      key={trait.key}
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          description: t(
                            `agent.panels.agentPanel.${trait.key}`,
                            trait.label,
                          ),
                        })
                      }
                      className={`flex items-center justify-between p-2 rounded border transition-colors w-full ${
                        formData.description ===
                        t(`agent.panels.agentPanel.${trait.key}`, trait.label)
                          ? "border-primary bg-primary/5"
                          : "border-[#E5E7EB] hover:border-[#3B82F6]"
                      }`}
                    >
                      <span className="text-sm text-[#374151]">
                        {t(`agent.panels.agentPanel.${trait.key}`, trait.label)}
                      </span>
                      <div className="flex items-center gap-1">
                        {formData.description ===
                          t(
                            `agent.panels.agentPanel.${trait.key}`,
                            trait.label,
                          ) && (
                          <RemixIcon
                            name="check"
                            size="size-3"
                            className="text-primary"
                          />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Model Section */}
              <div className="border border-[#E5E7EB] rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 mb-3">
                  <RemixIcon
                    name="cpu_line"
                    size="size-4"
                    className="text-[#6B7280]"
                  />
                  <h3 className="font-medium text-[#1F2937] text-sm">
                    {t("agent.panels.agentPanel.model", "Model")}
                  </h3>
                </div>
                <Select
                  value={formData.model}
                  onValueChange={(v) => setFormData({ ...formData, model: v })}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude-sonnet-4.6">
                      Claude Sonnet 4.6
                    </SelectItem>
                    <SelectItem value="claude-opus-4.6">
                      Claude Opus 4.6
                    </SelectItem>
                    <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Skills Section */}
              <div className="border border-[#E5E7EB] rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RemixIcon
                      name="apps_2_ai"
                      size="size-4"
                      className="text-[#6B7280]"
                    />
                    <h3 className="font-medium text-[#1F2937] text-sm">
                      {t("agent.panels.agentPanel.skills", "Skills")}
                    </h3>
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
                    <RemixIcon
                      name="add"
                      size="size-3"
                      className="text-primary"
                    />
                  </Button>
                </div>
                {selectedSkills.length === 0 ? (
                  <div className="text-center py-4">
                    <RemixIcon
                      name="apps_2_ai"
                      size="size-8"
                      className="text-[#D1D5DB] mb-2"
                    />
                    <p className="text-xs text-[#9CA3AF]">
                      {t("agent.panels.agentPanel.noSkills", "No skills yet")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedSkills.map((skill) => (
                      <div
                        key={skill}
                        className="flex items-center justify-between p-2 border border-[#E5E7EB] rounded"
                      >
                        <span className="text-sm text-[#374151]">{skill}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                        >
                          <RemixIcon
                            name="close"
                            size="size-3"
                            className="text-[#9CA3AF]"
                          />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* MCP Section */}
              <div className="border border-[#E5E7EB] rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RemixIcon
                      name="links_line"
                      size="size-4"
                      className="text-[#6B7280]"
                    />
                    <h3 className="font-medium text-[#1F2937] text-sm">MCP</h3>
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
                    <RemixIcon
                      name="add"
                      size="size-3"
                      className="text-primary"
                    />
                  </Button>
                </div>
                {selectedMCPs.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-xs text-[#9CA3AF]">
                      {t("agent.panels.agentPanel.noMCP", "No MCP yet")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedMCPs.map((mcp) => (
                      <div
                        key={mcp}
                        className="flex items-center justify-between p-2 border border-[#E5E7EB] rounded"
                      >
                        <div className="flex items-center gap-2">
                          <RemixIcon
                            name="links_line"
                            size="size-3"
                            className="text-[#6B7280]"
                          />
                          <span className="text-sm text-[#374151]">{mcp}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                        >
                          <RemixIcon
                            name="close"
                            size="size-3"
                            className="text-[#9CA3AF]"
                          />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Source Section */}
              <div className="border border-[#E5E7EB] rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <RemixIcon
                    name="git_pull_request_line"
                    size="size-4"
                    className="text-[#6B7280]"
                  />
                  <h3 className="font-medium text-[#1F2937] text-sm">
                    {t("agent.panels.agentPanel.source", "Source")}
                  </h3>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 bg-[#F9FAFB] rounded">
                    <div className="flex items-center gap-2">
                      <RemixIcon
                        name="github_fill"
                        size="size-4"
                        className="text-[#6B7280]"
                      />
                      <span className="text-xs text-[#374151]">
                        github.com/myrepo/agent
                      </span>
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
                      <RemixIcon
                        name="close"
                        size="size-3"
                        className="text-[#9CA3AF]"
                      />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-[#F9FAFB] rounded">
                    <div className="flex items-center gap-2">
                      <RemixIcon
                        name="slack"
                        size="size-4"
                        className="text-[#6B7280]"
                      />
                      <span className="text-xs text-[#374151]">
                        Slack Channel
                      </span>
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
                      <RemixIcon
                        name="close"
                        size="size-3"
                        className="text-[#9CA3AF]"
                      />
                    </Button>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2 text-xs"
                >
                  <RemixIcon name="add" size="size-3" className="mr-1.5" />
                  {t("agent.panels.agentPanel.addSource", "Add Source")}
                </Button>
              </div>

              {/* Related Automation Section */}
              <div className="border border-[#E5E7EB] rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <RemixIcon
                    name="cpu_line"
                    size="size-4"
                    className="text-[#6B7280]"
                  />
                  <h3 className="font-medium text-[#1F2937] text-sm">
                    {t("agent.panels.agentPanel.automation", "Automation")}
                  </h3>
                </div>
                {selectedAutomations.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-xs text-[#9CA3AF]">
                      {t(
                        "agent.panels.agentPanel.noAutomation",
                        "No automation yet",
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedAutomations.map((auto) => (
                      <div
                        key={auto}
                        className="flex items-center justify-between p-2 border border-[#E5E7EB] rounded"
                      >
                        <div className="flex items-center gap-2">
                          <RemixIcon
                            name="cpu_line"
                            size="size-3"
                            className="text-[#6B7280]"
                          />
                          <span className="text-sm text-[#374151]">{auto}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                        >
                          <RemixIcon
                            name="close"
                            size="size-3"
                            className="text-[#9CA3AF]"
                          />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Create/Save Button - Fixed at top right */}
      <div className="absolute top-0 right-0 p-4">
        <Button
          onClick={handleCreateAgent}
          disabled={!formData.name}
          className="bg-[#3B82F6] hover:bg-[#2563EB] text-white"
        >
          {t("common.save", "Save")}
        </Button>
      </div>
    </div>
  );
});
