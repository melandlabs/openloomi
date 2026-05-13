"use client";

import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@openloomi/ui";

type RoleAssignment = {
  role: string;
  source: string;
  confidence: number;
  lastConfirmedAt: string | null;
};

const ROLE_SOURCE_PRIORITY: Record<string, number> = {
  profile: 0,
  survey: 1,
  inference: 2,
};

/**
 * Props for the role selector component
 */
interface PersonalizationRolesProps {
  /** List of assigned roles */
  roleAssignments: RoleAssignment[];
  /** Maximum number of roles that can be selected */
  roleLimit: number;
  /** List of selectable roles */
  selectableRoles: string[];
  /** Currently selected roles */
  selectedRoles: string[];
  /** Role selection change callback */
  onRoleSelectionChange: (roleKey: string, nextState?: boolean) => void;
  /** Optional: callback when removing a manually selected role (for supporting custom role removal) */
  onRemoveRole?: (roleKey: string) => void;
}

/**
 * Role selector component
 * Displays detected roles and manually selected roles
 */
export function PersonalizationRoles({
  roleAssignments,
  roleLimit,
  selectableRoles,
  selectedRoles,
  onRoleSelectionChange,
  onRemoveRole,
}: PersonalizationRolesProps) {
  const { t } = useTranslation();

  /**
   * Format role key name
   */
  const formatRoleKey = useCallback((key: string) => {
    return key
      .split("_")
      .map((segment) =>
        segment.length > 0
          ? segment[0].toUpperCase() + segment.slice(1).toLowerCase()
          : segment,
      )
      .join(" ");
  }, []);

  /**
   * Get role label
   */
  const getRoleLabel = useCallback(
    (roleKey: string) =>
      t(`insightPreferences.roleOptions.${roleKey}.name`, {
        defaultValue: formatRoleKey(roleKey),
      }),
    [formatRoleKey, t],
  );

  /**
   * Get role description
   */
  const getRoleDescription = useCallback(
    (roleKey: string) =>
      t(`insightPreferences.roleOptions.${roleKey}.description`, {
        defaultValue: "",
      }),
    [t],
  );

  /**
   * Get role source label
   */
  const getRoleSourceLabel = useCallback(
    (source: string) =>
      t(`insightPreferences.roles.source.${source}`, {
        defaultValue: formatRoleKey(source),
      }),
    [formatRoleKey, t],
  );

  /**
   * Visible roles list (deduplicated and sorted)
   */
  const visibleRoles = useMemo(() => {
    const grouped = new Map<string, RoleAssignment>();
    for (const role of roleAssignments) {
      const priority = ROLE_SOURCE_PRIORITY[role.source] ?? 99;
      const existing = grouped.get(role.role);
      if (!existing) {
        grouped.set(role.role, role);
        continue;
      }
      const existingPriority = ROLE_SOURCE_PRIORITY[existing.source] ?? 99;
      if (priority < existingPriority) {
        grouped.set(role.role, role);
      }
    }
    return Array.from(grouped.values()).sort((a, b) => {
      const aPriority = ROLE_SOURCE_PRIORITY[a.source] ?? 99;
      const bPriority = ROLE_SOURCE_PRIORITY[b.source] ?? 99;
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      return getRoleLabel(a.role).localeCompare(getRoleLabel(b.role));
    });
  }, [getRoleLabel, roleAssignments]);

  /**
   * Role option entries
   */
  const roleOptionEntries = useMemo(
    () =>
      selectableRoles.map((role) => ({
        role,
        label: getRoleLabel(role),
        description: getRoleDescription(role),
      })),
    [getRoleDescription, getRoleLabel, selectableRoles],
  );

  /**
   * Selected role labels
   */
  const selectedRoleLabels = useMemo(
    () =>
      selectedRoles.map((role) => ({
        role,
        label: getRoleLabel(role),
      })),
    [getRoleLabel, selectedRoles],
  );

  /**
   * Selection summary text
   */
  const selectionSummary = selectedRoles.length
    ? t("insightPreferences.roles.selectedSummary", {
        count: selectedRoles.length,
      })
    : t("insightPreferences.roles.selectedEmpty");

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {t("insightPreferences.roles.heading")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("insightPreferences.roles.description")}
        </p>
      </div>

      {/* Currently detected roles */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">
          {t("insightPreferences.roles.currentLabel")}
        </p>
        <div className="flex flex-wrap gap-2">
          {visibleRoles.length > 0 ? (
            visibleRoles.map((role) => (
              <span
                key={`${role.role}-${role.source}`}
                className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs font-medium"
              >
                {getRoleLabel(role.role)}
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {getRoleSourceLabel(role.source)}
                </span>
              </span>
            ))
          ) : (
            <p className="text-xs italic text-muted-foreground">
              {t("insightPreferences.roles.noneDetected")}
            </p>
          )}
        </div>
      </div>

      {/* Manually selected roles (shows remove button when removal is supported) */}
      {selectedRoleLabels.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">
            {t("insightPreferences.roles.manualSelectedLabel")}
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedRoleLabels.map((role) => (
              <span
                key={role.role}
                className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
              >
                {role.label}
                {onRemoveRole ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => onRemoveRole(role.role)}
                    aria-label={t("common.remove", "Remove")}
                  >
                    <RemixIcon name="close" size="size-3" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Role selector */}
      <div className="space-y-1 z-[1010]">
        <div className="z-[1010] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="z-[1010] space-y-1 text-xs text-muted-foreground">
            <p>{selectionSummary}</p>
            <p>
              {t("insightPreferences.roles.selectionHint", {
                count: roleLimit,
              })}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="inline-flex items-center gap-2"
                disabled={roleOptionEntries.length === 0}
              >
                <span>
                  {selectedRoles.length
                    ? t("insightPreferences.roles.selectButtonActive", {
                        count: selectedRoles.length,
                      })
                    : t("insightPreferences.roles.selectButton")}
                </span>
                <RemixIcon
                  name="chevron_down"
                  size="size-4"
                  className="text-muted-foreground"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-72 !z-[1010] max-h-[480px] overflow-y-auto overflow-x-hidden"
            >
              <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground z-[1010]">
                {t("insightPreferences.roles.selectionLabel")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {roleOptionEntries.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.role}
                  checked={selectedRoles.includes(option.role)}
                  onCheckedChange={(checked) =>
                    onRoleSelectionChange(option.role, checked === true)
                  }
                  className="whitespace-normal py-2 !z-[1010]"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-foreground">
                      {option.label}
                    </span>
                    {option.description ? (
                      <span className="text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </div>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("insightPreferences.roles.selectionDescription")}
        </p>
      </div>
    </div>
  );
}
