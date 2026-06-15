// Extended translations - adds missing keys to @openloomi/i18n
import baseEn from "@openloomi/i18n/locales/en-US";

const en = {
  ...baseEn,
  common: {
    ...baseEn.common,
    export: "Export",
  },
  nav: {
    ...baseEn.nav,
    insights: "Insight",
    inbox: "Insight",
    termsAndPolicies: "Terms & Policies",
  },
  settings: {
    ...baseEn.settings,
    aiSettingsTitle: "API Settings",
    aiSettingsDescription:
      "Configure per-user API settings for compatible AI providers.",
    conversationModelsTitle: "Conversation models",
    aiSettingsOpenAiTitle: "OpenAI compatible",
    aiSettingsOpenAiDescription:
      "OpenAI, OpenRouter, Groq, Perplexity, or custom compatible endpoints",
    aiSettingsAnthropicTitle: "Anthropic compatible",
    aiSettingsAnthropicDescription:
      "Anthropic Claude or compatible provider endpoints",
    aiSettingsOverride: "User override",
    aiSettingsSystem: "System default",
    aiSettingsEnabled: "Enabled",
    aiSettingsApiKey: "API Key",
    aiSettingsBaseUrl: "Base URL",
    aiSettingsModel: "Model",
    aiSettingsOpenAiApiKeyPlaceholder: "For example: sk-...",
    aiSettingsAnthropicApiKeyPlaceholder: "For example: sk-ant-...",
    aiSettingsSavedApiKeyPlaceholder:
      "API key saved. Enter a new one here to update it.",
    aiSettingsUserApiKeyConfigured: "User API key configured",
    aiSettingsSystemApiKeyConfigured: "Using system API key",
    aiSettingsApiKeyNotConfigured: "No API key configured",
    aiSettingsDefaultBaseUrl: "Default URL",
    aiSettingsDefaultModel: "Default model",
    aiSettingsTestButton: "Test",
    aiSettingsTestSuccess: "Connection successful.",
    aiSettingsTestError:
      "Connection failed. Check the API key, base URL, and model.",
    aiSettingsResetButton: "Reset",
    aiSettingsSaved: "API settings saved.",
    aiSettingsSaveError: "Failed to save API settings.",
    aiSettingsReset: "User override reset to system defaults.",
    aiSettingsResetError: "Failed to reset API settings.",
    aiSettingsLoadError: "Failed to load API settings.",
    aiSettingsRequiredTitle: "Configure an API key to start chatting",
    aiSettingsRequiredDescription:
      "Enable an Anthropic-compatible provider and save its API key, base URL, and model before starting a conversation.",
    aiSettingsRequiredForChat: "Required for chat",
    aiSetupEyebrow: "One-minute setup",
    aiSetupTitle: "Connect your conversation model",
    aiSetupDescription:
      "OpenLoomi needs an Anthropic-compatible provider before it can start a conversation. Your credentials are stored securely and can be changed later.",
    aiSetupApiKey: "API key",
    aiSetupEndpoint: "Endpoint",
    aiSetupModel: "Model",
    aiSetupAction: "Set up provider",
    aiSetupHint:
      "Already configured by your administrator? Reload after the system key is added.",
    aiSetupCompactTitle: "Connect an AI provider to continue",
    aiSetupCompactDescription:
      "Your chat history is safe. Add a conversation API configuration to send new messages.",
    embeddingTitle: "Embedding models",
    embeddingDescription:
      "Choose how OpenLoomi creates vectors for knowledge, memory, and semantic search.",
    embeddingCloudTitle: "Online API",
    embeddingCloudDescription: "Use an OpenAI-compatible embedding endpoint.",
    embeddingLocalTitle: "Local model",
    embeddingLocalDescription: "Run a Transformers.js model on this device.",
    embeddingLocalModel: "Model ID or local path",
    embeddingCustomLocalModel: "Custom model ID or local path",
    embeddingCustomLocalModelPlaceholder:
      "Enter a Hugging Face model ID or local path",
    embeddingDevice: "Device",
    embeddingLocalOnly: "Use local files only",
    embeddingLocalOnlyDescription:
      "To use your own local model, enter its path and enable this option. Model downloads will be disabled, and only model files already available on this device will be loaded.",
    embeddingLocalDownloadHint:
      "The first test may download the model and take a little longer. After switching models, you need to restart the application.",
    embeddingUsageHint: "Used by knowledge base, memory, and semantic search.",
    embeddingSaved: "Embedding settings saved.",
    embeddingSaveError: "Failed to save embedding settings.",
    embeddingLoadError: "Failed to load embedding settings.",
    embeddingReset: "Embedding settings reset to system defaults.",
    embeddingResetError: "Failed to reset embedding settings.",
    embeddingTestSuccess:
      "Embedding test succeeded ({{dimensions}} dimensions).",
    embeddingTestError: "Embedding test failed. Check the configuration.",
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
    taskLabel: "Task Context",
    avatarHint: "Click to customize the context",
    taskHint: "Tell what you want it to help you with",
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
  meetingSummary: {
    selectAudioFile: "Select audio file",
    loadFailed: "Failed to load files. Please try again.",
  },
};

export default en;
