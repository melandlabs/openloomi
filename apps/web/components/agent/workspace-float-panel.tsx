"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { RemixIcon } from "@/components/remix-icon";
import { Button } from "@openloomi/ui";
import type { ChatMessage } from "@openloomi/shared";
import type { Insight } from "@/lib/db/schema";
import { getToolDisplayName } from "@/lib/utils/tool-names";

import { FilePreviewPanel } from "@/components/file-preview-panel";
import { FilePreviewDrawerShell } from "@/components/file-preview-drawer-shell";
import "../../i18n";

/** Single todo item parsed from chat messages */
export interface ParsedTodo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

/** Workspace float panel Props */
interface WorkspaceFloatPanelProps {
  /** Current chat ID, used to fetch workspace files */
  chatId: string | null;
  /** Current chat messages, used to parse Todos and tool invocations */
  messages: ChatMessage[];
  /** Whether the panel is expanded */
  open: boolean;
  /** Callback to close the panel */
  onClose: () => void;
  /** Callback when clicking a workspace file (optional, for opening in full workspace page) */
  onOpenWorkspace?: () => void;
  /** Callback when clicking an insight (for opening insight drawer in chat) */
  onOpenInsight: (insight: Insight) => void;
  /** Outer class name */
  className?: string;
}

const FLOAT_PANEL_WIDTH = 320;
const MAX_TODO_TITLE_LEN = 48;
const MAX_ARTIFACT_NAME_LEN = 36;

/**
 * Parses the TodoWrite todo list from messages (takes the last TodoWrite todos)
 */
function parseTodosFromMessages(messages: ChatMessage[]): ParsedTodo[] {
  let latestTodos: ParsedTodo[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const parts = (msg as any).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (part.type !== "tool-native") continue;
      const name = part.toolName ?? part.name;
      const rawName = typeof name === "string" ? name.split("__").pop() : name;
      if (rawName !== "TodoWrite") continue;
      const input = part.toolInput ?? part.args ?? {};
      const todos = input.todos;
      if (Array.isArray(todos) && todos.length > 0) {
        latestTodos = todos.map((t: any) => ({
          id: t.id ?? String(t.content ?? Math.random()).slice(0, 32),
          content:
            typeof t.content === "string" ? t.content : String(t.content ?? ""),
          status:
            t.status === "completed"
              ? "completed"
              : t.status === "in_progress"
                ? "in_progress"
                : "pending",
        }));
        return latestTodos;
      }
    }
  }
  return latestTodos;
}

/**
 * Parses tool names used in this conversation from messages (Skills & MCP)
 */
function parseToolNamesFromMessages(messages: ChatMessage[]): string[] {
  const names = new Set<string>();
  for (const msg of messages) {
    const parts = (msg as any).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (part.type !== "tool-native") continue;
      const name = part.toolName ?? part.name;
      if (typeof name === "string") {
        const display = name.split("__").pop() ?? name;
        if (display && display !== "TodoWrite") names.add(display);
      }
    }
  }
  return Array.from(names);
}

/**
 * Workspace float panel: displays Todos, Artifacts, Skills & MCP for the current conversation
 */
export function WorkspaceFloatPanel({
  chatId,
  messages,
  open,
  onClose,
  onOpenWorkspace,
  onOpenInsight,
  className,
}: WorkspaceFloatPanelProps) {
  const { t } = useTranslation();
  const [artifacts, setArtifacts] = useState<
    Array<{ name: string; path: string; type?: string }>
  >([]);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [linkedInsights, setLinkedInsights] = useState<Insight[]>([]);
  const [linkedInsightsLoading, setLinkedInsightsLoading] = useState(false);
  const [todosOpen, setTodosOpen] = useState(true);
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [artifactsOpen, setArtifactsOpen] = useState(true);
  const [skillsOpen, setSkillsOpen] = useState(true);
  const [previewFile, setPreviewFile] = useState<{
    path: string;
    name: string;
    type: string;
  } | null>(null);

  const handleOpenInsight = (insight: Insight) => {
    onOpenInsight(insight);
  };

  const todos = useMemo(() => parseTodosFromMessages(messages), [messages]);
  const toolNames = useMemo(
    () => parseToolNamesFromMessages(messages),
    [messages],
  );

  // Fetch artifacts
  useEffect(() => {
    if (!open || !chatId) {
      setArtifacts([]);
      return;
    }
    let cancelled = false;
    setArtifactsLoading(true);
    fetch(`/api/workspace/files?taskId=${encodeURIComponent(chatId)}`)
      .then((res) => (res.ok ? res.json() : { files: [] }))
      .then(
        (data: {
          files?: Array<{ name: string; path: string; type?: string }>;
        }) => {
          if (cancelled) return;
          const files = (data.files ?? []).filter((f: any) => !f.isDirectory);
          setArtifacts(files);
        },
      )
      .catch(() => {
        if (!cancelled) setArtifacts([]);
      })
      .finally(() => {
        if (!cancelled) setArtifactsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, open]);

  // Fetch historically linked insights
  useEffect(() => {
    if (!open || !chatId) {
      setLinkedInsights([]);
      return;
    }
    let cancelled = false;
    setLinkedInsightsLoading(true);
    fetch(`/api/chat-insights?chatId=${encodeURIComponent(chatId)}`)
      .then((res) => (res.ok ? res.json() : { insights: [] }))
      .then((data: { insights?: Insight[] }) => {
        if (cancelled) return;
        setLinkedInsights(data.insights ?? []);
      })
      .catch(() => {
        if (!cancelled) setLinkedInsights([]);
      })
      .finally(() => {
        if (!cancelled) setLinkedInsightsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, open]);

  const truncate = (s: string, max: number) =>
    s.length <= max ? s : `${s.slice(0, max)}...`;

  return (
    <>
      <div
        className={cn(
          "flex flex-col rounded-xl border border-border/60 bg-card/95 backdrop-blur-md shadow-lg overflow-hidden",
          !open && "hidden",
          className,
        )}
        style={{ width: FLOAT_PANEL_WIDTH }}
      >
        {/* Title bar: click "Chat Vault" to open full workspace */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60 shrink-0">
          {onOpenWorkspace ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto gap-1.5 px-0 font-semibold text-foreground text-sm hover:bg-transparent hover:text-primary"
              onClick={onOpenWorkspace}
              aria-label={t(
                "agent.workspaceFloat.openFullWorkspace",
                "Open full workspace",
              )}
            >
              <span>{t("agent.workspaceFloat.title", "Chat Vault")}</span>
              <RemixIcon name="external_link" size="size-3.5" />
            </Button>
          ) : (
            <span className="font-semibold text-foreground text-sm">
              {t("agent.workspaceFloat.title", "Chat Vault")}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onClose}
            aria-label={t("common.close", "Close")}
          >
            <RemixIcon name="close" size="size-4" />
          </Button>
        </div>

        <div className="max-h-[min(60vh,400px)] overflow-y-auto">
          <div className="px-3 py-2 space-y-0">
            {/* Historically linked Events section */}
            <section className="py-1">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 py-1.5 text-left text-sm font-medium text-foreground hover:bg-muted/50 rounded-md px-1"
                onClick={() => setInsightsOpen((o) => !o)}
              >
                <span>
                  {t("agent.workspaceFloat.linkedInsights", "Linked events")}
                </span>
                {insightsOpen ? (
                  <RemixIcon
                    name="chevron_down"
                    size="size-3.5"
                    className="text-muted-foreground shrink-0"
                  />
                ) : (
                  <RemixIcon
                    name="chevron_right"
                    size="size-3.5"
                    className="text-muted-foreground shrink-0"
                  />
                )}
              </button>
              {insightsOpen && (
                <div className="pl-1 mt-0.5">
                  {linkedInsightsLoading ? (
                    <p className="text-xs text-muted-foreground py-1">
                      {t("common.loading", "Loading...")}
                    </p>
                  ) : linkedInsights.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">
                      {t(
                        "agent.workspaceFloat.noLinkedInsights",
                        "No linked events",
                      )}
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {linkedInsights.map((insight) => (
                        <li
                          key={insight.id}
                          className="flex items-center gap-2 text-xs text-muted-foreground"
                        >
                          <RemixIcon
                            name="briefcase"
                            size="size-3.5"
                            className="text-muted-foreground shrink-0"
                          />
                          <button
                            type="button"
                            className="truncate text-left hover:text-foreground hover:underline transition-colors"
                            title={insight.title}
                            onClick={() => handleOpenInsight(insight)}
                          >
                            {truncate(insight.title, MAX_TODO_TITLE_LEN)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>

            {/* Todos section */}
            <section className="py-1">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 py-1.5 text-left text-sm font-medium text-foreground hover:bg-muted/50 rounded-md px-1"
                onClick={() => setTodosOpen((o) => !o)}
              >
                <span>{t("agent.workspaceFloat.todos", "Todos")}</span>
                {todosOpen ? (
                  <RemixIcon
                    name="chevron_down"
                    size="size-3.5"
                    className="text-muted-foreground shrink-0"
                  />
                ) : (
                  <RemixIcon
                    name="chevron_right"
                    size="size-3.5"
                    className="text-muted-foreground shrink-0"
                  />
                )}
              </button>
              {todosOpen && (
                <ul className="space-y-1 pl-1 mt-0.5">
                  {todos.length === 0 ? (
                    <li className="text-xs text-muted-foreground py-1">
                      {t("agent.workspaceFloat.noTodos", "No todos")}
                    </li>
                  ) : (
                    todos.map((todo) => (
                      <li
                        key={todo.id}
                        className="flex items-start gap-2 text-xs text-muted-foreground"
                      >
                        <span
                          className={cn(
                            "break-words",
                            todo.status === "completed" &&
                              "line-through opacity-80",
                          )}
                        >
                          {truncate(todo.content, MAX_TODO_TITLE_LEN)}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </section>

            {/* Artifacts section */}
            <section className="py-1">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 py-1.5 text-left text-sm font-medium text-foreground hover:bg-muted/50 rounded-md px-1"
                onClick={() => setArtifactsOpen((o) => !o)}
              >
                <span>{t("agent.workspaceFloat.artifacts", "Artifacts")}</span>
                {artifactsOpen ? (
                  <RemixIcon
                    name="chevron_down"
                    size="size-3.5"
                    className="text-muted-foreground shrink-0"
                  />
                ) : (
                  <RemixIcon
                    name="chevron_right"
                    size="size-3.5"
                    className="text-muted-foreground shrink-0"
                  />
                )}
              </button>
              {artifactsOpen && (
                <div className="pl-1 mt-0.5">
                  {artifactsLoading ? (
                    <p className="text-xs text-muted-foreground py-1">
                      {t("common.loading", "Loading...")}
                    </p>
                  ) : artifacts.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">
                      {t("agent.workspaceFloat.noArtifacts", "No files")}
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {artifacts.map((f) => {
                        const fileType =
                          f.name.split(".").pop()?.toLowerCase() || "";
                        return (
                          <li
                            key={f.path}
                            className="flex items-center gap-2 text-xs text-muted-foreground"
                          >
                            <RemixIcon
                              name="code"
                              size="size-3.5"
                              className="text-muted-foreground shrink-0"
                            />
                            <button
                              type="button"
                              className="truncate text-left hover:text-foreground hover:underline transition-colors"
                              title={f.name}
                              onClick={() => {
                                setPreviewFile({
                                  path: f.path,
                                  name: f.name,
                                  type: fileType,
                                });
                              }}
                            >
                              {truncate(f.name, MAX_ARTIFACT_NAME_LEN)}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </section>

            {/* Skills & MCP section */}
            <section className="py-1 pb-3">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 py-1.5 text-left text-sm font-medium text-foreground hover:bg-muted/50 rounded-md px-1"
                onClick={() => setSkillsOpen((o) => !o)}
              >
                <span>
                  {t("agent.workspaceFloat.skillsAndMcp", "Skills & MCP")}
                </span>
                {skillsOpen ? (
                  <RemixIcon
                    name="chevron_down"
                    size="size-3.5"
                    className="text-muted-foreground shrink-0"
                  />
                ) : (
                  <RemixIcon
                    name="chevron_right"
                    size="size-3.5"
                    className="text-muted-foreground shrink-0"
                  />
                )}
              </button>
              {skillsOpen && (
                <div className="pl-1 mt-0.5">
                  {toolNames.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">
                      {t(
                        "agent.workspaceFloat.noSkillsUsed",
                        "No skills used yet",
                      )}
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {toolNames.map((name) => (
                        <li
                          key={name}
                          className="flex items-center gap-2 text-xs text-muted-foreground"
                        >
                          <RemixIcon
                            name="layers"
                            size="size-3.5"
                            className="shrink-0"
                          />
                          <span className="truncate">
                            {getToolDisplayName(name, t)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {previewFile && (
        <FilePreviewDrawerShell onClose={() => setPreviewFile(null)}>
          <FilePreviewPanel
            file={previewFile}
            taskId={chatId || undefined}
            onClose={() => setPreviewFile(null)}
          />
        </FilePreviewDrawerShell>
      )}
    </>
  );
}
