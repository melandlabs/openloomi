// Extended translations - adds missing keys to @melandlabs/i18n
import baseEn from "@melandlabs/i18n/locales/en-US";

const en = {
  ...baseEn,
  chat: {
    ...baseEn.chat,
    stopGenerating: "Stop generating",
    goalCommandAttachmentsUnsupported:
      "Create the Goal without attachments, then add files in the chat.",
    goalCommandUnavailable: "Goal creation is unavailable in this chat.",
    goalCommandFailed: "Goal could not be created. Please try again.",
    commandMenu: "Commands",
    goalCommandMenuLabel: "Create a Goal",
    goalCommandMenuDescription: "Plan and run a long-running task",
    goalCommandMode: "Goal mode",
    codexTransport: {
      retrying:
        "Codex WebSocket timed out. Retrying; the task is still running.",
      retryingWithAttempt:
        "Codex WebSocket timed out. Retrying {{attempt}}/{{maxAttempts}}; the task is still running.",
      fallback:
        "Codex WebSocket timed out. Switching to HTTPS; the task is still running.",
    },
  },
  agentGoals: {
    title: "Goal",
    open: "Open Goal",
    description: "Manage this chat's active Goal",
    loading: "Loading Goal…",
    loadFailed: "Goal could not be loaded",
    create: "Create Goal",
    newGoal: "New Goal",
    detailFailed: "Goal details could not be loaded",
    loadingDetails: "Loading details…",
    live: "Live",
    offline: "Waiting",
    history: "Goal history",
    objective: "Objective",
    objectivePlaceholder: "What should the agent accomplish?",
    objectiveRequired: "Enter an objective.",
    planningHint:
      "The selected agent will plan the steps and work through them in order.",
    planning: "Planning…",
    steps: "Steps",
    stepsProgress: "{{done}} of {{total}} steps completed",
    pause: "Pause Goal",
    resume: "Continue Goal",
    usage: "Usage",
    turns: "Turns",
    tokens: "Tokens",
    elapsed: "Elapsed",
    dispatch: {
      sent: "Goal update sent to the agent runtime.",
      unavailable:
        "Goal saved. It will be delivered when an agent is active in this chat.",
      deferred: "Goal saved and queued behind the current runtime instruction.",
      retry: "Goal saved, but delivery to the agent needs another attempt.",
    },
    errors: {
      generic: "Something went wrong. Please try again.",
      revisionConflict:
        "This Goal changed elsewhere. The latest version has been loaded.",
      goalNotActive: "Only the active Goal can be changed.",
      noChange: "Nothing changed.",
      unauthorized: "Your session has expired. Sign in again.",
      runtimeUnavailable: "Goal Runtime is available in OpenLoomi Desktop.",
      recoveryRequired:
        "This Goal needs restart recovery before the agent can continue it.",
      planningFailed: "The agent could not plan this Goal. Please try again.",
      planningInProgress: "A Goal is already being planned for this chat.",
      startFailed:
        "The agent did not start this Goal. Check the runtime and try again.",
      requestFailed: "Goal request failed. Please try again.",
    },
    states: {
      active: "Active",
      paused: "Paused",
      completed: "Completed",
      cancelled: "Cancelled",
      failed: "Failed",
    },
  },
  common: {
    ...baseEn.common,
    export: "Export",
    toolNames: {
      ...(baseEn.common.toolNames ?? {}),
      queryCalendarEvents: "Querying Calendar Events",
      summarizeCalendarDuration: "Summarizing Calendar Duration",
      createCalendarMeeting: "Creating Calendar Meeting",
      refreshConnectorInsights: "Refreshing Connector Insights",
      executeTaskNow: "Executing Task Now",
      createTask: "Creating Task",
      getTaskInfo: "Getting Task Info",
      updateTaskSettings: "Updating Task Settings",
      bootstrapTaskConfiguration: "Bootstrapping Task Configuration",
      findReusableExecutors: "Finding Reusable Executors",
      linkExecutorToTask: "Linking Executor to Task",
      createScheduledExecutorForTask: "Creating Scheduled Executor",
      requestPlatformConnection: "Requesting Platform Connection",
      saveUserMemory: "Saving User Memory",
      time: "Getting Time",
      downloadInsightAttachment: "Downloading Insight Attachment",
      updateScheduledJob: "Updating Scheduled Job",
      deleteInsight: "Deleting Insight",
      AskUserQuestion: "Asking User",
      getCharacterInfo: "Getting Character Info",
      executeCharacter: "Executing Character",
      getCharacterExecutionHistory: "Getting Character History",
      getCharacterFiles: "Getting Character Files",
      updateCharacterSchedule: "Updating Character Schedule",
    },
  },
  nav: {
    ...baseEn.nav,
    insights: "Insight",
    inbox: "Insight",
    termsAndPolicies: "Terms & Policies",
    loop: "Loop",
  },
  loop: {
    title: "Loop",
    subtitle:
      "Proactive execution — pulls signals, classifies them, and asks you to approve.",
    enable: "Enable Loop",
    enabled: "Loop is on",
    disabled: "Loop is paused",
    label: {
      on: "Loop is on",
      off: "Loop is paused",
    },
    lastTick: "Last tick {{ts}}",
    tickNow: "Tick now",
    tickDone: "Tick done · surfaced {{n}}",
    tickFailed: "Tick failed: {{msg}}",
    toggleFailed: "Failed to update: {{msg}}",
    connectors: "Connectors",
    connectorsLoading: "Loading…",
    connectorsRefreshed: "Connectors refreshed",
    refresh: "Refresh",
    refreshFailed: "Refresh failed: {{msg}}",
    loadError: "Couldn't load: {{msg}}",
    loading: "Loading Loop…",
    sourceChain: "Source chain",
    why: "Why this surfaced",
    dryRun: "Dry run",
    edit: "Edit",
    run: "Run",
    dismiss: "Dismiss",
    viewDetails: "View details",
    dryRan: "Dry run completed",
    ran: "Decision executed",
    dismissed: "Dismissed",
    promoted: "Promoted",
    actionFailed: "Action failed: {{msg}}",
    ranAt: "Ran at {{ts}}",
    dismissedAt: "Dismissed",
    // #358 — structured execution outcome surfaced by the runner.
    outcome: {
      executed: "Executed",
      skipped: "Skipped",
      blocked: "Blocked",
      failed: "Failed",
      reason: "Reason: {{reason}}",
    },
    lastAttemptFailed: "Last attempt failed: {{reason}} — retry Run below.",
    tab: {
      pending: "Pending",
      done: "Done",
      dismissed: "Dismissed",
    },
    empty: {
      title: "Nothing here yet",
      pendingDesc:
        "Loop hasn't surfaced anything that needs your call. Hit Tick now to pull fresh signals.",
      doneDesc: "Approved decisions show up here once the agent finishes.",
      dismissedDesc:
        "Dismissed decisions live here so you can revisit them later.",
      runTick: "Run tick",
    },
    activation: {
      title: {
        activated: "Loop is ready",
        working: "Set up your first decision",
      },
      subtitle:
        "Connect a data source so Loomi can watch for decisions worth your attention.",
      step: {
        setup: "Setup",
        runtime: "Connect a source",
        source: "First check",
        check: "Wait for first decision",
        decision: "Review decision",
      },
      cta: {
        connectSource: "Connect a data source",
        runFirstCheck: "Run first check",
        reviewDecision: "Review first decision",
        finishSetup: "Finish setup",
        activated: "You're all set",
      },
      badge: {
        decision: "Decision waiting",
        check: "Run first check",
        source: "Connect a source",
        aiProvider: "Add AI key",
        setup: "Finish setup",
        title: {
          decision: "Open the Loop page to review your first decision",
          next: "Next activation step",
        },
      },
    },
    dialogue: {
      emailReply:
        "This email looks like it's waiting on you — should I draft a reply?",
      // #363 — replaces the hardcoded RSVP dialogue in server.ts::defaultDialogue
      rsvp: "This calendar invite needs your call.",
    },
    // #363 — RSVP-specific decision card layers (issue #363). Kept under
    // loop.rsvp.* so the same architecture can be adopted by email_reply /
    // review_pr etc. without a namespace collision.
    rsvp: {
      invitationLabel: "Calendar invitation",
      decidePrompt: "Will you attend this meeting?",
      attend: "Attend",
      decline: "Decline",
      viewOriginal: "View original",
      fieldTime: "Time",
      fieldOrganizer: "Organizer",
      fieldAttendance: "Attendance",
      fieldLocation: "Location",
      fieldConflict: "Conflict",
      conflictNone: "No conflict",
      readinessSufficient: "Information is sufficient to decide.",
      readinessIncomplete:
        "Information incomplete: {{fields}}. Review the original event before responding.",
      technicalDetails: "Technical details",
    },
    nextStep: {
      tapRun: "Tap Run to let the agent handle this decision.",
    },
    // #359 — plain-language decision state. Confidence (if shown elsewhere)
    // is diagnostic; the state pill is the primary surface and never derived
    // from classification confidence.
    readiness: {
      ready: "Ready to decide",
      needsContext: "Needs more context",
      notActionable: "No action needed",
      confirm: "Confirm carefully",
      missing: "Missing: {{fields}}",
    },
    confirmRun: "Confirm & run",
    confidenceShort: "conf {{n}}",
    confidenceDiagnostic:
      "Classification confidence (diagnostic — not urgency)",
    detailTitle: "Decision",
    backToList: "Back to loop",
    detail: {
      statusLabel: {
        pending: "Pending",
        done: "Done",
        dismissed: "Dismissed",
      },
      confidenceBadge: "conf {{n}}",
      openFirstDecision: "Open first decision",
      backToLoop: "Back to Loop",
      notFoundDesc: {
        firstTime:
          "This decision isn't around anymore — but your top pending one is waiting.",
      },
      created: "Created {{ts}}",
      dryRunLabel: "Dry run plan",
      dryReady: "Ready",
      dryRerun: "Re-run dry",
      dryRunButton: "Run dry",
      dryRunning: "Running…",
      dryEmpty:
        "No plan yet. Hit Run dry to have the agent draft what it would do — without committing anything.",
      dryWaiting: "Agent is working on the plan. This takes a few seconds…",
      dryFailed: "Dry run failed: {{msg}}",
      dryDone: "Dry run ready · review the plan, then hit Run.",
      actionLabel: "Action",
      actionCopy: "Copy",
      actionCopiedShort: "Copied",
      actionCopied: "Action copied to clipboard",
      actionHide: "Hide",
      actionShow: "Show",
      noParams: "No parameters — the agent will infer what to do from context.",
      runButton: "Run",
      running: "Running…",
      runFailed: "Run failed: {{msg}}",
      ranToast: "Decision executed",
      editButton: "Edit",
      dismissButton: "Dismiss",
      dismissReasonLabel: "Why dismiss? (optional, helps Loop learn)",
      dismissPlaceholder: "e.g. already handled via Slack",
      confirmDismiss: "Confirm dismiss",
      cancel: "Cancel",
      dismissFailed: "Dismiss failed: {{msg}}",
      dismissedToast: "Dismissed",
      resultLabel: "Result",
      noResult:
        "Ran without attaching a result payload — check the agent logs.",
      ranAt: "Ran at {{ts}}",
      dismissedLabel: "Dismissed",
      dismissedNoReason: "No reason recorded.",
      // #358 — verdict-specific labels for the result panel header and
      // the resurrect button on a skipped/non-executed done row.
      executedLabel: "Executed",
      skippedLabel: "Skipped",
      executedBadge: "Executed",
      resurrect: "Run again",
      resurrectedToast: "Back to pending",
      resurrectFailed: "Re-run failed: {{msg}}",
      lastAttemptFailed: "Last attempt failed: {{reason}} — retry Run below.",
      promote: "Promote back to pending",
      promotedToast: "Back to pending",
      promoteFailed: "Promote failed: {{msg}}",
      whyLabel: "Why this surfaced",
      noWhy: "No notes yet.",
      contextLabel: "Context",
      noContextChips: "No linked memory or contacts.",
      sourceSignal: "Source signal",
      metaLabel: "Meta",
    },
    // #365 — idle pill and compact status card copy. The pill text
    // (loop.idlePill.short / cta) is intentionally short so it fits
    // inside the 168×168 pet window without overlapping the fox; the
    // compact card carries the verbose copy under loop.compactCard.*.
    idlePill: {
      short: "Loomi is on watch · Nothing needs your attention",
      cta: "View status",
      paused: "Monitoring paused",
      working: "Checking your connected sources…",
      failure: "Couldn't reach {{source}} · Review needed",
    },
    compactCard: {
      title: {
        healthy: "Everything is working",
        checking: "Checking your sources",
        paused: "Monitoring is paused",
        failure: "{{source}} needs attention",
      },
      subtitle: {
        healthy:
          "Nothing needs your attention. Loomi will open a card when a decision needs you.",
        checking: "Loomi is checking your sources now.",
        paused: "Loop is paused — nothing will surface until you resume.",
        failure:
          "Loomi couldn't update {{source}} recently. Review the original before continuing.",
      },
      lastChecked: "Last checked: {{rel}}",
      lastCheckedNever: "Last checked: never",
      syncHealthy: "Sync is healthy",
      sourcesLabel: "Watching",
      sourcesEmpty: "No sources connected",
      collapse: "Collapse",
      openLoop: "Open Loop",
    },
  },
  settings: {
    ...baseEn.settings,
    aiSettingsTitle: "Settings",
    loopSectionTitle: "Loop (proactive execution)",
    loopEnableLabel: "Enable the Loop",
    loopEnableDescription:
      "Continuously pulls external signals (Gmail, Calendar, GitHub, Slack), classifies them into typed decisions, and surfaces them to the desktop pet.",
    loopBriefTimeLabel: "Morning brief time",
    loopWrapTimeLabel: "Evening wrap time",
    loopIntervalLabel: "Tick interval (seconds)",
    loopSaveError: "Failed to save Loop settings.",
    loopSaveOk: "Loop settings saved.",
    loopNoticeDescription:
      "Loop is on — Loomi reads your mail, calendar, code, and chat through your connectors in the background and combines that with screen memory to fill your morning brief. Toggle off here if you'd rather not.",
    aiSettingsDescription:
      "Choose and save one conversation model provider. API keys are encrypted at rest; Ollama and AWS IAM credentials do not require a stored key.",
    aiSettingsProvider: "Model provider",
    aiSettingsProviderHint:
      "Choose and configure one provider. Saving a complete configuration makes it the active conversation model provider.",
    agentRuntimeTitle: "Detected local agent runtimes",
    agentRuntimeDescription:
      "Choose the local agent runtime OpenLoomi uses for new tasks. Running tasks are not interrupted.",
    agentRuntimeClaudeDescription:
      "Powered by Claude Agent SDK with its runtime bundled in OpenLoomi—no separate Claude CLI installation required. Use a saved Anthropic-compatible API configuration or existing Claude authentication.",
    agentRuntimeCodexDescription:
      "Use your local Codex CLI installation and account.",
    agentRuntimeOpenCodeDescription:
      "Use your local OpenCode CLI and its configured model providers.",
    agentRuntimeHermesDescription:
      "Use your local Hermes ACP runtime and configured model provider.",
    agentRuntimeOpenClawDescription:
      "Use your local OpenClaw CLI with a reachable authenticated Gateway.",
    agentRuntimeChecking: "Checking local runtimes…",
    agentRuntimeBuiltIn: "Built in",
    agentRuntimeReady: "Ready",
    agentRuntimeAuthenticationRequired: "Authentication required",
    agentRuntimeLoginRequired: "Sign-in required",
    agentRuntimeSetupRequired: "Setup required",
    agentRuntimeNotInstalled: "Not installed",
    agentRuntimeBuiltInUnavailable: "Built-in runtime unavailable",
    agentRuntimeUnverifiedShort: "Could not verify",
    agentRuntimeInUse: "In use",
    agentRuntimeReadyDescription:
      "{{runtime}} is installed and configured. This check does not start a model request.",
    agentRuntimeClaudeApiReadyDescription:
      "The built-in Claude runtime will use your saved Anthropic-compatible configuration. Test the connection below, then confirm it with a new task.",
    agentRuntimeClaudeAuthReadyDescription:
      "The built-in Claude runtime found existing Claude authentication. This check does not start a model request.",
    agentRuntimeClaudeAuthenticationDescription:
      "Save an Anthropic-compatible API configuration below. If this OS account already has Claude authentication, check again to reuse it.",
    agentRuntimeLoginDescription:
      "Run this command in a terminal, finish signing in, then check again.",
    agentRuntimeSetupDescription:
      "Run this command in a terminal, complete setup, then check again.",
    agentRuntimeCodexLoginDescription:
      "OpenLoomi will run Codex CLI's browser sign-in. After you finish signing in with ChatGPT, Codex will be checked and selected automatically.",
    agentRuntimeCodexLogin: "Sign in and use Codex",
    agentRuntimeCodexLoginWaiting: "Finish signing in in your browser…",
    agentRuntimeCodexLoginSuccess: "Codex CLI is signed in and selected.",
    agentRuntimeCodexLoginError:
      "Could not sign in or enable Codex. Try again.",
    agentRuntimeCodexInstallAndLogin: "Install and sign in to Codex",
    agentRuntimeCodexInstallWaiting:
      "Installing Codex CLI; browser sign-in will open next…",
    agentRuntimeCodexInstallSuccess:
      "Codex CLI is installed, signed in, and selected.",
    agentRuntimeCodexInstallError:
      "Could not install Codex CLI automatically. Use the manual instructions below, then try again.",
    agentRuntimeCodexAutoInstallDescription:
      "Selecting “Install and sign in to Codex” downloads and runs OpenAI's official installer for this Windows account, updates the user PATH, and then opens Codex's browser sign-in.",
    agentRuntimeCodexManualInstallTitle: "Manual installation (fallback)",
    agentRuntimeCodexInstallTitle: "Install Codex CLI",
    agentRuntimeCodexInstallOpenTerminal: "Open {{terminal}}.",
    agentRuntimeCodexInstallRunInstaller:
      "Copy and run the official install command.",
    agentRuntimeCodexInstallSkipLaunch:
      'When "Start Codex now? [y/N]" appears at the end, press Enter to keep the default N. Do not start Codex yet.',
    agentRuntimeCodexInstallExitAccidentalLaunch:
      'If you already selected y and see "Hooks need review", select "3. Continue without trusting". After Codex opens, enter /exit or press Ctrl+C to close it.',
    agentRuntimeCodexInstallReturn:
      "After installation, return here and select {{checkAction}}. When Codex CLI is found, select {{loginAction}} to finish in your browser and enable it automatically.",
    agentRuntimeTerminal: "Terminal",
    agentRuntimeClaudeUnavailableDescription:
      "OpenLoomi could not load its built-in Claude runtime. Update or repair the desktop app, then check again.",
    agentRuntimeCliUnavailableDescription:
      "{{runtime}} was not found. Open the official instructions, install it for this OS account, then check again.",
    agentRuntimeUnverified: "OpenLoomi could not verify the local runtimes.",
    agentRuntimeUnverifiedDescription:
      "OpenLoomi could not verify this CLI. Confirm it runs in your terminal, then check again.",
    agentRuntimeClaudeUnverifiedDescription:
      "OpenLoomi could not verify the built-in Claude runtime. Open the troubleshooting guide, then check again.",
    agentRuntimeManagedByEnvironment:
      "The current runtime is managed by the environment: {{provider}}. Choose a detected runtime to create a desktop preference.",
    agentRuntimePreferenceOverrideDescription:
      "This desktop preference overrides the environment/default runtime for new tasks.",
    agentRuntimeUseManagedSetting: "Use environment/default",
    agentRuntimePreferenceCleared: "Desktop runtime preference cleared.",
    agentRuntimeClearError: "Failed to restore the managed runtime setting.",
    agentRuntimeOfficialInstructions: "Official instructions",
    agentRuntimeSetupGuide: "Setup guide",
    agentRuntimeTroubleshootingGuide: "Troubleshooting guide",
    agentRuntimeCheckAgain: "Re-detect",
    agentRuntimeTryAgain: "Try again",
    agentRuntimeUse: "Use {{runtime}}",
    agentRuntimeCopy: "Copy",
    agentRuntimeCopied: "Copied",
    agentRuntimeSaved: "Agent runtime updated for new tasks.",
    agentRuntimeLoadError: "Failed to check agent runtimes.",
    agentRuntimeSaveError: "Failed to update the agent runtime.",
    agentRuntimeNotReadyError:
      "The selected runtime is no longer ready. Complete setup and check again.",
    conversationModelsTitle: "Conversation models",
    aiSettingsOpenAiTitle: "OpenAI compatible",
    aiSettingsOpenAiDescription:
      "OpenAI, OpenRouter, Groq, Perplexity, or custom compatible endpoints",
    aiSettingsAnthropicTitle: "Anthropic compatible",
    aiSettingsAnthropicDescription:
      "Anthropic Claude or compatible provider endpoints",
    aiSettingsOverride: "User override",
    aiSettingsSystem: "System default",
    aiSettingsActive: "Active",
    aiSettingsConfigured: "Configured",
    aiSettingsNotConfigured: "Not configured",
    aiSettingsApiKey: "API Key",
    aiSettingsOptionalApiKey: "API Key (optional)",
    aiSettingsBaseUrl: "Base URL",
    aiSettingsAwsRegion: "AWS Region",
    aiSettingsModel: "Model",
    aiSettingsTransportConverse: "Converse",
    aiSettingsTransportMessages: "Messages",
    aiSettingsTransportChatCompletions: "Chat Completions",
    aiSettingsProviderNames: {
      openai_compatible: "OpenAI compatible",
      anthropic_compatible: "Anthropic compatible",
      openrouter: "OpenRouter",
      bedrock: "AWS Bedrock",
      gemini: "Google Gemini",
      ollama: "Ollama",
      deepseek: "DeepSeek",
      xai: "xAI (Grok)",
    },
    aiSettingsProviderDescriptions: {
      openai_compatible:
        "OpenAI or another endpoint implementing Chat Completions.",
      anthropic_compatible:
        "Anthropic Claude or another endpoint implementing Messages.",
      openrouter: "OpenRouter's model catalog through Chat Completions.",
      bedrock: "Claude, Nova, Llama, and DeepSeek through Bedrock Converse.",
      gemini: "Gemini models through Google AI Studio's OpenAI-compatible API.",
      ollama: "Local Llama, Mistral, and other models served by Ollama.",
      deepseek: "DeepSeek chat and reasoning models through the DeepSeek API.",
      xai: "Grok models through xAI's Chat Completions API.",
    },
    aiSettingsProviderApiKeyPlaceholders: {
      openai_compatible: "For example: sk-...",
      anthropic_compatible: "For example: sk-ant-...",
      openrouter: "For example: sk-or-v1-...",
      bedrock: "Optional Bedrock API key",
      gemini: "For example: AIza...",
      ollama: "Not required",
      deepseek: "For example: sk-...",
      xai: "For example: xai-...",
    },
    aiSettingsOpenAiApiKeyPlaceholder: "For example: sk-...",
    aiSettingsAnthropicApiKeyPlaceholder: "For example: sk-ant-...",
    aiSettingsSavedApiKeyPlaceholder:
      "API key saved. Enter a new one here to update it.",
    aiSettingsUserApiKeyConfigured: "User API key configured",
    aiSettingsSystemApiKeyConfigured: "Using system API key",
    aiSettingsApiKeyNotConfigured: "No API key configured",
    aiSettingsApiKeyNotRequired: "This provider does not require an API key",
    aiSettingsBedrockCredentialChain:
      "Uses the default AWS credential chain when left blank",
    aiSettingsDefaultBaseUrl: "Default URL",
    aiSettingsDefaultRegion: "Default region",
    aiSettingsDefaultModel: "Default model",
    aiSettingsTestButton: "Test",
    aiSettingsTestSuccess: "Connection successful.",
    aiSettingsTestError:
      "Connection failed. Check the API key, base URL, and model.",
    aiSettingsResetButton: "Reset",
    aiSettingsSaved: "API settings saved.",
    aiSettingsSavedAndEnabled: "API settings saved and provider enabled.",
    aiSettingsSaveError: "Failed to save API settings.",
    aiSettingsReset: "User override reset to system defaults.",
    aiSettingsResetError: "Failed to reset API settings.",
    aiSettingsLoadError: "Failed to load API settings.",
    aiSettingsRequiredTitle: "Configure a model provider to start chatting",
    aiSettingsRequiredDescription: "Choose and save any supported provider.",
    aiSettingsRequiredForChat: "Required for chat",
    llmUsageTitle: "API usage",
    llmUsageLocalBadge: "Local",
    llmUsageLoading: "Loading usage…",
    llmUsageUnconfigured:
      "Save a provider configuration to start tracking token usage.",
    llmUsageError: "Usage tracking is unavailable right now.",
    llmUsageProvider: "Active provider",
    llmUsageRequests: "Requests",
    llmUsageTokens: "Tokens",
    llmUsageTokensIn: "in",
    llmUsageTokensOut: "out",
    llmUsageLastActivity: "Last activity",
    llmUsageFootnote:
      "Token counts are recorded locally by OpenLoomi and may exclude requests that fail before the provider reports usage. Your provider's billing dashboard remains the source of truth for spend.",
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
    embeddingSelectProviderHint:
      "Pick an embedding provider above to configure it.",
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
    needYouToKnow: "Need to Know",
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
    deadlineReminderTitle: "Deadline {{when}}",
    deadlineReminderBody: "{{subject}} is due {{when}}.",
    deadlineReminderCta: "Add reminder",
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
  chronicle: {
    settings: {
      title: "Screen Memory",
      sectionTitle: "Chronicle",
      subtitle: "Capture and remember what's on your screen",
      description:
        "Press your chosen shortcut to capture the screen, analyze it with AI, and save it as memory. Useful for recalling important things you see during the day.",
      howItWorks:
        "Press the {{shortcut}} key from any app to capture the current screen",
      privacyNote: "Screenshots are stored locally and analyzed securely",
      debounceNote: "At least {{seconds}}s between captures",
      captureInterval: "Capture interval",
      captureIntervalHint: "Minimum seconds between captures (≥3s)",
      captureIntervalSaved: "Capture interval saved",
      captureIntervalSaveError: "Failed to save capture interval",
      captureShortcut: "Capture shortcut",
      captureShortcutHint: "Press Esc to cancel editing.",
      shortcutDisplay: "{{shortcut}}",
      editShortcut: "Edit",
      saveShortcut: "Save",
      cancelShortcut: "Cancel",
      shortcutInvalid:
        "Unknown key id. Use the exact desktop key name (e.g. Enter, F9).",
      shortcutPressPrompt:
        "Click the area below to focus it, then press the key to bind. Current: {{current}}",
      shortcutListening: "Waiting for a key…",
      shortcutUnsupportedKey: "That key is not supported. Try another key.",
      shortcutPickFirst: "Press a key to bind before saving.",
      warning:
        "This feature captures your screen. Make sure you understand the privacy implications before enabling.",
      enabled: "Screen Memory enabled",
      disabled: "Screen Memory disabled",
      bootCheckEnabled: "Screen Memory enabled successfully",
      permissionDenied:
        "Screen Recording was not granted. If you previously declined, enable this app under System Settings → Screen & System Audio Recording.",
      accessibilityDenied:
        "Accessibility was not granted, so the global capture shortcut cannot work. Enable this app under System Settings → Privacy & Security → Accessibility.",
      saveError: "Failed to save Screen Memory settings",
      loading: "Loading...",
      visionLlm: {
        title: "Custom Vision LLM",
        description:
          "Use your own OpenAI-compatible vision model to analyze screenshots. When enabled, the built-in analyzer is bypassed and requests are sent to your endpoint.",
        apiUrl: "Base URL",
        apiKey: "API Key",
        model: "Model",
        saveError: "Failed to save custom vision LLM settings",
      },
      meetingRecording: {
        title: "Meeting Recording",
        description:
          "Automatically record meeting audio from Google Meet, Lark, and other platforms. Audio is transcribed and summarized automatically.",
        howItWorks:
          "Click the microphone button to start recording, or enable auto-detection to start automatically when meeting audio is detected.",
        autoDetection: "Auto-detect meeting start",
        saveError: "Failed to save meeting recording settings",
        permissionDenied: "Microphone permission denied",
        recordingStarted: "Meeting recording started",
        recordingStopped: "Meeting recording stopped",
        processing: "Processing meeting audio...",
        summaryReady: "Meeting summary ready",
        silenceDetected: "Silence detected, recording stopped",
        audioTooLarge: "Recording is too large. Please keep it under 500MB.",
        noSpeechDetected: "No clear speech detected, recording discarded",
      },
    },
    permissionGuide: {
      title: "Screen Memory Permissions",
      description:
        "The following permissions are required to use Screen Memory",
      accessibilityTitle: "Accessibility Permission",
      accessibilityDesc:
        "Required for global shortcut to capture screen (no restart needed)",
      screenRecordingTitle: "Screen Recording Permission",
      screenRecordingDesc:
        "Required to capture screen content (may require app restart)",
      authorize: "Authorize",
      openSettings: "System Settings",
      cancel: "Cancel",
      complete: "Complete",
    },
    meeting: {
      silenceDetected: "Silence detected, recording stopped",
      audioTooLarge: "Recording is too large. Please keep it under 500MB.",
      permissionDenied: "Microphone permission denied, please enable and retry",
      audioNotSupported: "Current environment does not support audio recording",
      recordFailed: "Audio recording failed, please retry",
      noSpeechDetected: "No clear speech detected, recording discarded",
      processing: "Processing meeting audio...",
      summaryReady: "Meeting summary ready",
      systemAudioPrePrompt:
        'A sharing dialog will appear — check "Share system audio" at the bottom to capture remote participants',
      systemAudioFallback:
        'System audio not captured. To record remote participants, check "Share system audio" next time',
      systemAudioStopped:
        "System audio sharing stopped, now recording microphone only",
      systemAudioOnly: "No microphone detected — recording system audio only",
      systemAudioCaptureFailed:
        "System audio capture failed. Enable System Audio for this app in System Settings → Privacy & Security → Screen & System Audio Recording, then retry",
      systemAudioCaptureUnavailable:
        "Could not capture system audio. Please restart the application and try again",
      restartToRecordTitle: "A restart is needed",
      restartToRecordDescription:
        "System audio isn't available right now. Restarting the app will restore recording.",
      restartToRecordConfirm: "Restart app",
      restartToRecordCancel: "Not now",
      alreadyRecording: "Recording already in progress",
      noAudioSource:
        "Cannot start recording: microphone or system audio permission required",
      recordingFailed: "Recording failed, please retry",
      micPermissionDenied:
        "Microphone permission denied, please enable and retry",
      noActiveChat: "No active chat",
      envNotSupportRecording:
        "Current environment does not support audio recording",
      uploadAudioFailed: "Failed to upload audio file",
      recordingSaved: "Recording saved: {{fileName}}",
      recordingSavedToSpace:
        "Recording saved to conversation space: {{fileName}}",
    },
    meetingSummary: {
      systemAudioPermission: {
        title: "Recording Permissions",
        description:
          "To record meeting audio, please grant microphone and system audio permissions.",
        microphoneTitle: "Microphone",
        microphoneDesc:
          "Required for capturing your voice during meeting recording",
        systemAudioTitle: "System Audio",
        systemAudioDesc:
          "Required for capturing system audio during meeting recording",
      },
    },
  },
};

export default en;
