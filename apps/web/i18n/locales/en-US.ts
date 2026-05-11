// Extended translations - adds missing keys to @alloomi/i18n
import baseEn from "@alloomi/i18n/locales/en-US";

const en = {
  ...baseEn,
  common: {
    ...baseEn.common,
    export: "Export",
  },
  nav: {
    ...baseEn.nav,
    insights: "Insight Tracking",
    inbox: "Insight Tracking",
    termsAndPolicies: "Terms & Policies",
  },
  insight: {
    ...(baseEn.insight ?? {}),
    tabs: {
      ...(baseEn.insight?.tabs ?? {}),
      preset: {
        ...(baseEn.insight?.tabs?.preset ?? {}),
        importantPeople: "Important people",
        importantPeopleDesc:
          "Filter insights from important people or key contacts",
      },
    },
    analytics: {
      ...((
        baseEn.insight as typeof baseEn.insight & {
          analytics?: Record<string, unknown>;
        }
      ).analytics ?? {}),
      tab: "Analytics",
      title: "Usage Analytics",
      generatedAt: "Updated {{time}}",
      loadFailed: "Analytics failed to load",
      totalInsights: "Total insights",
      activeInsights: "Active / 30d",
      dormantInsights: "Dormant",
      averageScore: "Average score",
      topInsights: "Top insights",
      bottomInsights: "Dormant insights",
      noUsageData: "No usage data yet",
      noDormantData: "No dormant insights",
      trends: "Trend analysis",
      relationships: "Relationship analysis",
      noRelationships: "No repeated relationships yet",
      organizationRecommendations: "Organization recommendations",
      noRecommendations: "No cleanup needed",
      neverAccessed: "Never",
      noAccess: "No access",
      untitled: "Untitled insight",
      accesses30dShort: "{{count}} / 30d",
      totalAccessesShort: "{{count}} total",
      conversationCount: "{{count}} conversations",
      accessCount30d: "{{count}} accesses / 30d",
      scoreValue: "score {{score}}",
      trend: {
        rising: "Rising",
        stable: "Stable",
        falling: "Falling",
      },
      action: {
        keep: "Keep",
        archive: "Archive",
        delete: "Delete",
      },
      reason: {
        favorited: "Favorited insights are treated as intentionally retained.",
        deleteDormant:
          "No recent usage and low value score for more than 90 days.",
        archiveDormant: "Dormant for at least 30 days with low recent value.",
        archiveFalling:
          "Usage is falling and value score is below the active threshold.",
        keepActive:
          "Usage, freshness, or relevance still supports keeping it active.",
      },
    },
  },
  character: {
    ...baseEn.character,
    newCharacter: "New Mate",
    namePlaceholder: "Mate Name",
    dailyFocus: "Daily Focus",
    dailyFocusLoading: "Loading...",
    dailyFocusEmpty: "No focus data yet",
    dailyFocusNothingMajor: "Nothing major happened today",
    dailyFocusNoData: "No data",
    dailyFocusAnalysisComplete: "Daily focus analysis complete",
    dailyFocusItemsAnalyzed: "{{count}} items analyzed",
    dailyFocusV1Summary:
      "{{urgent}} urgent, {{important}} important, {{monitor}} monitoring",
    dailyFocusReasoningChain: "Reasoning Chain ({{count}})",
    dailyFocusRawContent: "Raw Content",
    dailyFocusActionPrefix: "Action: {{label}}",
    dailyFocusTodayBadge: "Today",
    dailyFocusDeadline: "Due {{deadline}}",
    dailyFocusOverdueDeadline: "Overdue · {{deadline}}",
    dailyFocusCollapseSection: "Collapse",
    dailyFocusExpandSection: "Expand",
    executionStatusRunning: "Running",
    executionStatusSuccess: "Completed",
    executionStatusTimeout: "Timed out",
    executionStatusError: "Failed",
    datePending: "Time pending",
    noOutput: "No output for this execution",
    taskListShowAll: "Show all",
    taskListOnlyWithResults: "Only show items with results",
    taskListOnlyFilesEmpty: "No tasks with file output yet",
    addMessageChannel: "Add message channel",
    taskLabel: "Mate's Task",
    avatarHint: "Click to customize the mate avatar",
    taskHint: "Tell your mate what you want it to help you with",
    taskPlaceholder: "For example: Summarize AI industry news every morning.",
    taskScheduleLabel: "Task Schedule",
    taskScheduleHint:
      "Tell your mate when you want it to execute tasks for you.",
    completionNotificationLabel: "Completion Notification",
    completionNotificationHint:
      "When your mate completes a task, the result will be synced to you through the following channels.",
    moreConfig: "More configuration",
    tooltips: {
      selectModel: "Select model",
      selectSkill:
        "Loading different skills helps your mate gain specialized capabilities.",
      addMessageChannel:
        "Connecting different channels gives your mate a more precise message scope.",
      addFile:
        "Uploading different files gives your mate more task background context.",
    },
    sources: {
      ...baseEn.character?.sources,
      uploadLocal: "Upload from local",
      addFile: "Add File",
      bindFolder: "Bind Folder",
    },
    notificationChannels: "Notification Channels",
    marketplaceGroupAll: "All",
    marketplaceGroup: {
      office: "Office",
      product: "Product",
      marketing: "Marketing",
      sales: "Sales",
      finance: "Finance",
      legal: "Legal",
    },
  },
  templateCharacter: {
    ...baseEn.templateCharacter,
  },
};

export default en;
