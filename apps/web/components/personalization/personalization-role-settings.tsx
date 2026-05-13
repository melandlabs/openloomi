"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  useRef,
} from "react";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import { fetcher } from "@/lib/utils";
import { toast } from "@/components/toast";
import { RemixIcon } from "@/components/remix-icon";
import { Label, Textarea, type Option, MultipleSelector } from "@openloomi/ui";

type RoleAssignment = {
  role: string;
  source: string;
  confidence: number;
  lastConfirmedAt: string | null;
};

type RolePreferencesResponse = {
  assigned: RoleAssignment[];
  manual: string[];
  options: string[];
  limit: number;
};

type IdentitySummary = {
  industries: string[];
  primaryIndustry: string | null;
  workDescription: string | null;
  lastUpdated: string | null;
} | null;

type InsightPreferencesResponse = {
  focusPeople: string[];
  focusTopics: string[];
  language: string;
  refreshIntervalMinutes: number;
  roles?: RolePreferencesResponse;
  identity?: IdentitySummary;
};

const DEFAULT_ROLE_LIMIT = 4;
const MAX_INDUSTRIES = 4;
const MAX_DESCRIPTION_LENGTH = 5000;

/** Industry options (consistent with onboarding survey, for multi-select + custom) */
const INDUSTRY_OPTIONS = [
  { value: "IT/Technology", labelKey: "survey.step1.q1.options.it" },
  { value: "Finance/Investment", labelKey: "survey.step1.q1.options.finance" },
  {
    value: "Education/Training",
    labelKey: "survey.step1.q1.options.education",
  },
  { value: "Media/Advertising", labelKey: "survey.step1.q1.options.media" },
  { value: "E-commerce/Retail", labelKey: "survey.step1.q1.options.retail" },
  {
    value: "Logistics/Supply Chain",
    labelKey: "survey.step1.q1.options.logistics",
  },
  {
    value: "Consulting/Professional Services",
    labelKey: "survey.step1.q1.options.consulting",
  },
  { value: "Gaming/Entertainment", labelKey: "survey.step1.q1.options.gaming" },
  { value: "Healthcare", labelKey: "survey.step1.q1.options.healthcare" },
  { value: "Real Estate", labelKey: "survey.step1.q1.options.realEstate" },
  { value: "Manufacturing", labelKey: "survey.step1.q1.options.manufacturing" },
  { value: "Energy", labelKey: "survey.step1.q1.options.energy" },
  { value: "Agriculture", labelKey: "survey.step1.q1.options.agriculture" },
  { value: "Travel/Tourism", labelKey: "survey.step1.q1.options.travel" },
  { value: "Food & Beverage", labelKey: "survey.step1.q1.options.food" },
] as const;

/**
 * Hook for fetching role and identity settings data
 */
function useRolePreferences() {
  const { data, isLoading, mutate, error } = useSWR<InsightPreferencesResponse>(
    "/api/preferences/insight",
    fetcher,
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateOnMount: true,
      dedupingInterval: 5000,
    },
  );

  if (error) {
    console.error("[Personalization Roles] Fetch failed", error);
  }

  return { data, isLoading, mutate };
}

interface PersonalizationRoleSettingsProps {
  open: boolean;
  /** When true, omit the top intro and outer py/px (parent supplies scroll-area padding, e.g. About me page) */
  hideIntro?: boolean;
}

export interface PersonalizationRoleSettingsRef {
  save: () => Promise<void>;
  isSaving: boolean;
}

/**
 * “My Description” form component
 * Vertical form: My Industry (max 4, multi-select+custom), My Role (max 4, multi-select+custom), My Description (textarea max 5000 chars)
 */
export const PersonalizationRoleSettings = forwardRef<
  PersonalizationRoleSettingsRef,
  PersonalizationRoleSettingsProps
>(({ open: _open, hideIntro = false }, ref) => {
  const { t } = useTranslation();
  const { data, isLoading, mutate } = useRolePreferences();

  const [industries, setIndustries] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [workDescription, setWorkDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  // Debounce ref: tracks pending persist timer to avoid flooding API with rapid keystrokes
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track whether user is actively typing in the textarea to prevent SWR data from overwriting input
  const isTypingRef = useRef(false);

  // Track current form values, persistAll reads directly from ref to avoid stale closure
  const currentValues = useRef({
    industries: [] as string[],
    roles: [] as string[],
    workDescription: "",
  });
  // Also store data in ref to avoid persistAll closure staleness
  const dataRef = useRef<InsightPreferencesResponse | undefined>(undefined);

  const roleLimit = data?.roles?.limit ?? DEFAULT_ROLE_LIMIT;
  const selectableRoles = data?.roles?.options ?? [];

  const industryOptions = useMemo(
    () =>
      INDUSTRY_OPTIONS.map((o) => ({
        value: o.value,
        label: t(o.labelKey),
      })),
    [t],
  );

  const getRoleLabel = useCallback(
    (roleKey: string) =>
      t(`insightPreferences.roleOptions.${roleKey}.name`, {
        defaultValue: roleKey
          .split("_")
          .map((s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s))
          .join(" "),
      }),
    [t],
  );

  const roleOptions = useMemo(
    () =>
      selectableRoles.map((role) => ({
        value: role,
        label: getRoleLabel(role),
      })),
    [selectableRoles, getRoleLabel],
  );

  /**
   * Save entire form (industry, roles, work description) to insight preferences
   */
  const persistAll = useCallback(async () => {
    if (!hasHydrated) return;
    setIsSaving(true);
    try {
      // Also read industries and workDescription from ref to avoid closure capturing stale values
      const {
        industries: ind,
        roles: rol,
        workDescription: wd,
      } = currentValues.current;
      const payload = {
        focusPeople: dataRef.current?.focusPeople ?? [],
        focusTopics: dataRef.current?.focusTopics ?? [],
        language: dataRef.current?.language ?? "",
        refreshIntervalMinutes: dataRef.current?.refreshIntervalMinutes ?? 30,
        roleKeys: rol,
        industries: ind.slice(0, MAX_INDUSTRIES),
        workDescription: wd.slice(0, MAX_DESCRIPTION_LENGTH),
      };

      const response = await fetch("/api/preferences/insight", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(await response.text());

      const next = (await response.json()) as InsightPreferencesResponse;
      await mutate(next, { revalidate: false });
      currentValues.current = {
        industries: ind.slice(0, MAX_INDUSTRIES),
        roles: rol,
        workDescription: wd,
      };
    } catch (err) {
      console.error("[Personalization RoleSettings] Update failed", err);
      toast({
        type: "error",
        description: t("insightPreferences.toast.failure"),
      });
    } finally {
      setIsSaving(false);
    }
  }, [hasHydrated, mutate, t]);

  /**
   * Debounced persist: clears any pending timer and schedules a new one.
   * Use instead of `persistAll()` directly for rapid-fire calls (e.g. textarea onChange).
   */
  const debouncedPersist = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      void persistAll();
    }, 500);
  }, [persistAll]);

  useEffect(() => {
    if (!data || isTypingRef.current) return;
    const identityIndustries = data.identity?.industries ?? [];
    const identityWork = data.identity?.workDescription ?? "";
    const manualRoles = data.roles?.manual ?? [];
    setIndustries(identityIndustries);
    setWorkDescription(identityWork);
    setSelectedRoles(manualRoles);
    setHasHydrated(true);
    currentValues.current = {
      industries: identityIndustries,
      roles: manualRoles,
      workDescription: identityWork,
    };
    dataRef.current = data;
  }, [data]);

  const getIndustryLabel = useCallback(
    (v: string) => {
      const o = INDUSTRY_OPTIONS.find((x) => x.value === v);
      return o ? t(o.labelKey) : v;
    },
    [t],
  );

  const industryValueAsOptions: Option[] = useMemo(
    () =>
      industries.map((v) => ({
        value: v,
        label: getIndustryLabel(v),
      })),
    [industries, getIndustryLabel],
  );

  const roleValueAsOptions: Option[] = useMemo(
    () =>
      selectedRoles.map((v) => ({
        value: v,
        label: getRoleLabel(v),
      })),
    [selectedRoles, getRoleLabel],
  );

  useImperativeHandle(ref, () => ({
    async save() {
      await persistAll();
    },
    isSaving,
  }));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <RemixIcon
          name="loader_2"
          size="size-4"
          className="mr-2 animate-spin"
        />
        {t("insightPreferences.loading")}
      </div>
    );
  }

  return (
    <div className={hideIntro ? "space-y-6" : "space-y-6 py-6 px-8"}>
      {!hideIntro && (
        <p className="max-w-full text-xs text-muted-foreground">
          {t("insightPreferences.identity.introDescription")}
        </p>
      )}
      <div className="flex flex-col gap-6">
        {/* My Industry: cmdk multi-select, badge in input, support custom creation */}
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="mb-0 text-sm font-medium text-foreground leading-tight block">
              {t("insightPreferences.identity.industryLabel", "My industry")}
            </Label>
            <p className="text-sm text-muted-foreground leading-snug">
              {t(
                "insightPreferences.identity.industryHint",
                "Select up to 4, choose from below or enter custom",
              )}
            </p>
          </div>
          <MultipleSelector
            value={industryValueAsOptions}
            defaultOptions={industryOptions}
            onChange={(opts) => {
              const next = opts.map((o) => o.value);
              setIndustries(next);
              currentValues.current.industries = next;
              void persistAll();
            }}
            placeholder={t(
              "insightPreferences.identity.industryTriggerPlaceholder",
              "Select or enter industry",
            )}
            maxSelected={MAX_INDUSTRIES}
            creatable
            hideClearAllButton
            hidePlaceholderWhenSelected
            emptyIndicator={
              <p className="text-center text-sm text-muted-foreground">
                {t(
                  "insightPreferences.identity.emptyResults",
                  "No results, enter custom",
                )}
              </p>
            }
          />
        </div>

        {/* My Role: cmdk multi-select, badge in input, support custom creation */}
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="mb-0 text-sm font-medium text-foreground leading-tight block">
              {t("insightPreferences.identity.roleLabel", "My role")}
            </Label>
            <p className="text-sm text-muted-foreground leading-snug">
              {t(
                "insightPreferences.identity.roleHint",
                "Select up to 4, choose from list or enter custom",
              )}
            </p>
          </div>
          <MultipleSelector
            value={roleValueAsOptions}
            defaultOptions={roleOptions}
            onChange={(opts) => {
              const next = opts.map((o) => o.value);
              setSelectedRoles(next);
              currentValues.current.roles = next;
              void persistAll();
            }}
            placeholder={t(
              "insightPreferences.identity.roleTriggerPlaceholder",
              "Select or enter a role",
            )}
            maxSelected={roleLimit}
            creatable
            hideClearAllButton
            hidePlaceholderWhenSelected
            emptyIndicator={
              <p className="text-center text-sm text-muted-foreground">
                {t(
                  "insightPreferences.identity.emptyResults",
                  "No results, enter custom",
                )}
              </p>
            }
          />
        </div>

        {/* My Description: work content, textarea max 5000 chars */}
        <div className="space-y-3">
          <div className="space-y-1">
            <Label
              className="mb-0 text-sm font-medium text-foreground leading-tight block"
              htmlFor="work-description"
            >
              {t(
                "insightPreferences.identity.workDescriptionLabel",
                "My description",
              )}
            </Label>
            <p className="text-sm text-muted-foreground leading-snug">
              {t(
                "insightPreferences.identity.workDescriptionHint",
                "Work description, up to 5000 characters",
              )}
            </p>
          </div>
          <Textarea
            id="work-description"
            value={workDescription}
            onChange={(e) => {
              const next = e.target.value.slice(0, MAX_DESCRIPTION_LENGTH);
              setWorkDescription(next);
              currentValues.current.workDescription = next;
              isTypingRef.current = true;
              void debouncedPersist();
              // Unset isTyping flag slightly after the debounce window
              setTimeout(() => {
                isTypingRef.current = false;
              }, 600);
            }}
            placeholder={t(
              "insightPreferences.identity.workDescriptionPlaceholder",
              "Describe your daily work and responsibilities",
            )}
            maxLength={MAX_DESCRIPTION_LENGTH}
            className="min-h-[120px] resize-y"
          />
          <p className="text-xs text-muted-foreground">
            {workDescription.length} / {MAX_DESCRIPTION_LENGTH}
          </p>
        </div>
      </div>
    </div>
  );
});

PersonalizationRoleSettings.displayName = "PersonalizationRoleSettings";
