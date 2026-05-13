"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import cx from "classnames";

import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { RemixIcon } from "@/components/remix-icon";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import { buildRefMarker } from "@openloomi/shared/ref";
import type { Insight } from "@/lib/db/schema";

type SkillItem = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  author?: string;
  argumentHint?: string;
};

type SelectedSkill = {
  id: string;
  name: string;
};

type SelectedEvent = {
  id: string;
  title: string;
};

interface SkillEventInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}

/**
 * Reusable Skill/Event input component
 * Supports / to trigger skill selection, @ to trigger event search
 * Displays selected skill/event in input as deletable badges
 */
export function SkillEventInput({
  value,
  onChange,
  placeholder,
  rows = 3,
  className,
}: SkillEventInputProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Skill list
  const { data: skillsData } = useSWR<{
    success: boolean;
    skills: SkillItem[];
  }>("/api/workspace/skills", fetcher, { revalidateOnFocus: false });
  const skillsList = skillsData?.skills ?? [];

  // Selected skills (parsed from text)
  const selectedSkills = useMemo(() => {
    const skills: SelectedSkill[] = [];
    // Allow skill tokens without trailing whitespace, and tokens adjacent like `/id1/id2`.
    // We only render a badge if `skillId` exists in `skillsList` to avoid false positives.
    const regex = /\/([\w-]+)(?=\s|$|\/)/g;
    const matches = value.matchAll(regex);
    for (const match of matches) {
      const skillId = match[1];
      const skill = skillsList.find((s) => s.id === skillId);
      if (!skill) continue;
      if (!skills.find((s) => s.id === skillId)) {
        skills.push({
          id: skillId,
          name: skill.name,
        });
      }
    }
    return skills;
  }, [value, skillsList]);

  // Selected events (parsed from text)
  const selectedEvents = useMemo(() => {
    const events: SelectedEvent[] = [];
    const regex = /\[\[ref:event:([^\]]*)\]\]/g;
    const matches = value.matchAll(regex);
    for (const match of matches) {
      const label = match[1];
      // label format is id|title or only id
      const parts = label.split("|");
      const eventId = parts[0].trim();
      const eventTitle = parts.slice(1).join("|").trim() || eventId;
      if (!events.find((e) => e.id === eventId)) {
        events.push({ id: eventId, title: eventTitle });
      }
    }
    return events;
  }, [value]);

  // Menu state
  const [isSlashOpen, setIsSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashHighlightedIndex, setSlashHighlightedIndex] = useState(0);
  const slashRangeRef = useRef<{ start: number; end: number } | null>(null);
  const slashListRef = useRef<HTMLDivElement>(null);

  const [isAtMentionOpen, setIsAtMentionOpen] = useState(false);
  const [atMentionQuery, setAtMentionQuery] = useState("");
  const atMentionRangeRef = useRef<{ start: number; end: number } | null>(null);
  const [atMentionHighlightedIndex, setAtMentionHighlightedIndex] = useState(0);
  const atMentionListRef = useRef<HTMLDivElement>(null);

  /**
   * Detect platform after client mount; use queueMicrotask to avoid sync setState in effect (eslint react-hooks/set-state-in-effect).
   */
  // Track whether mouse is in menu area
  const isMenuMouseOverRef = useRef(false);

  // Event search state
  const [eventSearchQuery, setEventSearchQuery] = useState("");
  const [debouncedEventQuery, setDebouncedEventQuery] = useState("");
  const eventSearchUrl = useMemo(() => {
    if (debouncedEventQuery.trim()) {
      return `/api/search?q=${encodeURIComponent(debouncedEventQuery)}&types=events&limit=50`;
    }
    return "/api/insights/events?limit=20&days=0";
  }, [debouncedEventQuery]);

  const { data: eventSearchData } = useSWR(eventSearchUrl, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  // Parse event list
  const eventList = useMemo((): Insight[] => {
    if (!eventSearchData) return [];
    if (eventSearchData.events) {
      return eventSearchData.events
        .map((item: any) => item.extra?.insight)
        .filter(
          (insight: Insight | undefined): insight is Insight => !!insight,
        );
    }
    if (eventSearchData.items) {
      return eventSearchData.items;
    }
    return [];
  }, [eventSearchData]);

  // Filter skills list
  const filteredSkills = useMemo(() => {
    const q = slashQuery.trim().toLowerCase();
    if (!q) return skillsList;
    return skillsList.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q),
    );
  }, [skillsList, slashQuery]);

  // Filter events list
  const filteredEvents = useMemo(() => {
    const q = eventSearchQuery.trim().toLowerCase();
    if (!q) return eventList;
    return eventList.filter(
      (event) =>
        (event.title ?? "").toLowerCase().includes(q) ||
        (event.description ?? "").toLowerCase().includes(q),
    );
  }, [eventList, eventSearchQuery]);

  // Handle text input
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value;
      const cursor = e.target.selectionStart ?? v.length;

      // Detect / to trigger skill menu
      const lastSlash = v.lastIndexOf("/", cursor - 1);
      if (lastSlash !== -1) {
        const textAfterSlash = v.slice(lastSlash + 1, cursor);
        const query = textAfterSlash.trim();
        const isValidSkillTrigger = /^[\w-]*$/.test(query);
        // Require / to NOT follow an alphanumeric char (excludes URLs like https://)
        const charBeforeSlash = lastSlash > 0 ? v[lastSlash - 1] : "";
        const isValidCharBeforeSlash = !/[a-zA-Z0-9]/.test(charBeforeSlash);

        if (isValidSkillTrigger && isValidCharBeforeSlash) {
          slashRangeRef.current = { start: lastSlash, end: cursor };
          setSlashQuery(query);
          setSlashHighlightedIndex(0);
          setIsSlashOpen(true);
          setIsAtMentionOpen(false);
          onChange(v);
          return;
        }
      }

      // Detect @ to trigger event menu
      const lastAt = v.lastIndexOf("@", cursor - 1);
      if (lastAt !== -1) {
        const textAfterAt = v.slice(lastAt + 1, cursor);
        // Only trigger if no space after @
        if (!textAfterAt.includes(" ") && !textAfterAt.includes("\n")) {
          atMentionRangeRef.current = { start: lastAt, end: cursor };
          setAtMentionQuery(textAfterAt);
          setAtMentionHighlightedIndex(0);
          setIsAtMentionOpen(true);
          setIsSlashOpen(false);
          onChange(v);
          return;
        }
      }

      // Close menu
      if (!v.slice(0, cursor).includes("/")) {
        setIsSlashOpen(false);
        slashRangeRef.current = null;
      }
      if (!v.slice(0, cursor).includes("@")) {
        setIsAtMentionOpen(false);
        atMentionRangeRef.current = null;
      }

      onChange(v);
    },
    [onChange],
  );

  // Open skill menu (button trigger)
  const openSkillMenu = useCallback(() => {
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    // Insert / at cursor position as trigger
    slashRangeRef.current = { start: cursor, end: cursor };
    setSlashQuery("");
    setSlashHighlightedIndex(0);
    setIsSlashOpen(true);
    setIsAtMentionOpen(false);
  }, [value]);

  // Open event menu (button trigger)
  const openEventMenu = useCallback(() => {
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    // Insert @ at cursor position as trigger
    atMentionRangeRef.current = { start: cursor, end: cursor };
    setAtMentionQuery("");
    setAtMentionHighlightedIndex(0);
    setIsAtMentionOpen(true);
    setIsSlashOpen(false);
  }, [value]);

  // Insert skill
  const insertSkill = useCallback(
    (skillId: string) => {
      const range = slashRangeRef.current;
      let start: number;
      let end: number;
      if (range) {
        start = range.start;
        end = range.end;
        slashRangeRef.current = null;
      } else {
        start = value.length;
        end = value.length;
      }
      const token = `/${skillId} `;
      const newValue = value.slice(0, start) + token + value.slice(end);
      onChange(newValue);
      setSlashQuery("");
      setIsSlashOpen(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [value, onChange],
  );

  // Insert event
  const insertEvent = useCallback(
    (event: Insight) => {
      const range = atMentionRangeRef.current;
      let start: number;
      let end: number;
      if (range) {
        start = range.start;
        end = range.end;
        atMentionRangeRef.current = null;
      } else {
        start = value.length;
        end = value.length;
      }
      // Use [[ref:event:id|title]] format
      const marker = buildRefMarker(
        "event",
        `${event.id}|${event.title || event.id}`,
      );
      const trailingSpace = " ";
      const newValue =
        value.slice(0, start) + marker + trailingSpace + value.slice(end);
      onChange(newValue);
      setIsAtMentionOpen(false);
      setEventSearchQuery("");
      setDebouncedEventQuery("");
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [value, onChange],
  );

  // Remove selected skill
  const removeSkill = useCallback(
    (skillId: string) => {
      // Remove /skillId format
      const regex = new RegExp(`/${skillId}\\s?`, "g");
      const newValue = value.replace(regex, "");
      onChange(newValue);
    },
    [value, onChange],
  );

  // Remove selected event
  const removeEvent = useCallback(
    (eventId: string) => {
      // Remove [[ref:event:id|...]] format
      const regex = new RegExp(
        `\\[\\[ref:event:${eventId}\\|[^\\]]*\\]\\]\\s?`,
        "g",
      );
      const newValue = value.replace(regex, "");
      onChange(newValue);
    },
    [value, onChange],
  );

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Skill menu keyboard navigation
      if (isSlashOpen && filteredSkills.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashHighlightedIndex((i) =>
            i < filteredSkills.length - 1 ? i + 1 : 0,
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashHighlightedIndex((i) =>
            i > 0 ? i - 1 : filteredSkills.length - 1,
          );
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const skill = filteredSkills[slashHighlightedIndex];
          if (skill) insertSkill(skill.id);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setIsSlashOpen(false);
          return;
        }
      }

      // Event menu keyboard navigation
      if (isAtMentionOpen && filteredEvents.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtMentionHighlightedIndex((i) =>
            i < filteredEvents.length - 1 ? i + 1 : 0,
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtMentionHighlightedIndex((i) =>
            i > 0 ? i - 1 : filteredEvents.length - 1,
          );
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const event = filteredEvents[atMentionHighlightedIndex];
          if (event) insertEvent(event);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setIsAtMentionOpen(false);
          return;
        }
      }
    },
    [
      isSlashOpen,
      isAtMentionOpen,
      filteredSkills,
      filteredEvents,
      slashHighlightedIndex,
      atMentionHighlightedIndex,
      insertSkill,
      insertEvent,
    ],
  );

  // Debounce event search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedEventQuery(eventSearchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [eventSearchQuery]);

  // Scroll to highlighted item
  useEffect(() => {
    if (isSlashOpen && slashListRef.current) {
      const highlighted = slashListRef.current.querySelector(
        `[data-index="${slashHighlightedIndex}"]`,
      );
      highlighted?.scrollIntoView({ block: "nearest" });
    }
  }, [slashHighlightedIndex, isSlashOpen]);

  useEffect(() => {
    if (isAtMentionOpen && atMentionListRef.current) {
      const highlighted = atMentionListRef.current.querySelector(
        `[data-index="${atMentionHighlightedIndex}"]`,
      );
      highlighted?.scrollIntoView({ block: "nearest" });
    }
  }, [atMentionHighlightedIndex, isAtMentionOpen]);

  return (
    <div className={cx("relative", className)}>
      {/* Selected badges */}
      {(selectedSkills.length > 0 || selectedEvents.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedSkills.map((skill) => (
            <span
              key={skill.id}
              className="inline-flex items-center justify-start min-h-5 gap-1 rounded-[6px] border border-border/70 bg-surface px-1.5 py-0.5 text-xs font-medium text-foreground max-w-[140px] min-w-0 mr-1 overflow-hidden"
            >
              <i className="ri-apps-2-ai-line" />
              <span className="flex-1 min-w-0 truncate whitespace-nowrap">
                {skill.name}
              </span>
              <button
                type="button"
                onClick={() => removeSkill(skill.id)}
                className="hover:text-amber-800 dark:hover:text-amber-200 ml-0.5"
              >
                <RemixIcon name="close" size="size-3" />
              </button>
            </span>
          ))}
          {selectedEvents.map((event) => (
            <span
              key={event.id}
              className="inline-flex items-center justify-start min-h-5 gap-1 rounded-[6px] border border-border/70 bg-surface px-1.5 py-0.5 text-xs font-medium text-foreground max-w-[140px] min-w-0 mr-1 overflow-hidden"
            >
              <i className="ri-radar-line" />
              <span className="flex-1 min-w-0 truncate whitespace-nowrap">
                {event.title}
              </span>
              <button
                type="button"
                onClick={() => removeEvent(event.id)}
                className="hover:text-indigo-800 dark:hover:text-indigo-200 ml-0.5"
              >
                <RemixIcon name="close" size="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input field */}
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={(e) => {
            // Check if focus moved to menu area
            const relatedTarget = e.relatedTarget as HTMLElement | null;
            const isFocusInMenu =
              relatedTarget?.closest('[role="option"]') ||
              relatedTarget?.closest('input[placeholder*="Search"]') ||
              relatedTarget?.closest(".skill-event-menu");

            if (isFocusInMenu) {
              return; // Don't close menu
            }

            // Delay closing menu to ensure menu item click can trigger
            setTimeout(() => {
              if (!isMenuMouseOverRef.current) {
                setIsSlashOpen(false);
                setIsAtMentionOpen(false);
              }
            }, 200);
          }}
          placeholder={placeholder}
          rows={rows}
          className={cx(
            "min-h-[80px]",
            (isSlashOpen || isAtMentionOpen) &&
              "ring-2 ring-primary ring-offset-1",
          )}
        />

        {/* Action buttons */}
        <div className="flex gap-1 mt-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0 rounded-lg"
            onClick={openEventMenu}
            aria-label={t("chat.addEvent", "Add event")}
          >
            @
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0 rounded-lg"
            onClick={openSkillMenu}
            aria-label={t("chat.addSkill", "Select skill")}
          >
            <RemixIcon name="apps_2_ai" size="size-4" />
          </Button>
        </div>

        {/* Skill menu */}
        {isSlashOpen && (
          <div
            ref={slashListRef}
            role="menu"
            className={cx(
              "absolute top-full left-0 right-0 z-[100] mt-2 w-full min-w-[220px] max-h-[280px] overflow-y-auto",
              "rounded-xl border border-border/80 bg-popover/95 backdrop-blur-sm shadow-xl",
              "animate-in fade-in-0 zoom-in-95 duration-150 skill-event-menu",
            )}
            onMouseEnter={() => {
              isMenuMouseOverRef.current = true;
            }}
            onMouseLeave={() => {
              isMenuMouseOverRef.current = false;
            }}
          >
            <div className="p-1.5">
              {filteredSkills.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center">
                  <span className="text-muted-foreground/80 text-sm">
                    {skillsList.length === 0
                      ? t("chat.noSkills", "No skills available")
                      : t("chat.noMatch", "No matching items")}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {filteredSkills.map((skill, index) => {
                    const isHighlighted = index === slashHighlightedIndex;
                    return (
                      <div
                        key={skill.id}
                        data-index={index}
                        role="option"
                        aria-selected={isHighlighted}
                      >
                        <button
                          type="button"
                          className={cx(
                            "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                            "hover:bg-accent hover:text-accent-foreground",
                            isHighlighted &&
                              "bg-accent text-accent-foreground shadow-sm",
                          )}
                          onClick={() => insertSkill(skill.id)}
                        >
                          <span
                            className={cx(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                              isHighlighted
                                ? "bg-primary/15 text-primary"
                                : "bg-muted/80 text-muted-foreground",
                            )}
                          >
                            <RemixIcon name="apps_2_ai" size="size-4" />
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="block truncate font-normal">
                              {skill.name}
                            </span>
                            {skill.description && (
                              <span className="block truncate text-xs text-muted-foreground">
                                {skill.description}
                              </span>
                            )}
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Event search menu */}
        {isAtMentionOpen && (
          <div
            ref={atMentionListRef}
            role="menu"
            className={cx(
              "absolute top-full left-0 right-0 z-[100] mt-2 w-full min-w-[220px] max-h-[320px] overflow-y-auto",
              "rounded-xl border border-border/80 bg-popover/95 backdrop-blur-sm shadow-xl",
              "flex flex-col",
              "animate-in fade-in-0 zoom-in-95 duration-150 skill-event-menu",
            )}
            onMouseEnter={() => {
              isMenuMouseOverRef.current = true;
            }}
            onMouseLeave={() => {
              isMenuMouseOverRef.current = false;
            }}
          >
            {/* Search input */}
            <div className="p-2 border-b">
              <div className="relative">
                <RemixIcon
                  name="search"
                  size="size-4"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="text"
                  placeholder={t(
                    "chat.searchEventPlaceholder",
                    "Search events...",
                  )}
                  value={eventSearchQuery}
                  onChange={(e) => setEventSearchQuery(e.target.value)}
                  className="pl-9 pr-8"
                  autoFocus
                />
                {eventSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setEventSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                  >
                    <RemixIcon name="close" size="size-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Event list */}
            <div className="flex-1 overflow-y-auto">
              <div className="p-1.5">
                {filteredEvents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center">
                    <span className="text-muted-foreground/80 text-sm">
                      {eventSearchQuery.trim()
                        ? t("chat.noEventsFound", "No matching events found")
                        : t("chat.noEvents", "No events")}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {filteredEvents.map((event, index) => {
                      const isHighlighted = index === atMentionHighlightedIndex;
                      return (
                        <div
                          key={event.id}
                          data-index={index}
                          role="option"
                          aria-selected={isHighlighted}
                        >
                          <button
                            type="button"
                            className={cx(
                              "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                              "hover:bg-accent hover:text-accent-foreground",
                              isHighlighted &&
                                "bg-accent text-accent-foreground shadow-sm",
                            )}
                            onClick={() => insertEvent(event)}
                          >
                            <span
                              className={cx(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                                isHighlighted
                                  ? "bg-primary/15 text-primary"
                                  : "bg-muted/80 text-muted-foreground",
                              )}
                            >
                              <RemixIcon name="calendar-event" size="size-4" />
                            </span>
                            <div className="flex-1 min-w-0">
                              <span className="block truncate font-normal">
                                {event.title ||
                                  t("chat.untitledEvent", "Untitled event")}
                              </span>
                              {event.description && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {event.description}
                                </span>
                              )}
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
