# OpenLoomi Codex Plugin Roadmap

This roadmap tracks the planned implementation path for the OpenLoomi Codex
plugin. The README describes the plugin design; this file tracks milestones,
deliverables, acceptance criteria, and open questions.

## Phase 1: Documentation Structure

Goal: establish the official plugin documentation layout.

Deliverables:

- `plugins/codex/README.md`
- `plugins/codex/ROADMAP.md`
- documentation structure that can be mirrored by `plugins/claude`

Acceptance criteria:

- the Codex plugin documentation lives under `plugins/codex`;
- the README describes architecture and user flows;
- the roadmap describes implementation phases and future work;

## Phase 2: MVP Plugin Skeleton

Goal: create the smallest installable Codex plugin structure.

Deliverables:

```text
plugins/codex/
  .codex-plugin/plugin.json
  skills/openloomi/SKILL.md
  scripts/loomi-bridge.mjs
  assets/logo.png
```

Acceptance criteria:

- Codex can discover the plugin;
- the plugin advertises OpenLoomi as a local assistant and memory layer;
- the `openloomi` skill can call `loomi-bridge`;
- no connector or memory business logic is copied into the plugin.

## Phase 3: Discovery and Readiness

Goal: detect existing OpenLoomi installs and report readiness.

Deliverables:

- packaged install discovery;
- source checkout discovery;
- `openloomi-ctl --version` validation;
- token presence check;
- AI provider readiness check;
- optional local API reachability check;
- stable `setup-status` JSON.

Acceptance criteria:

- packaged install detected;
- source checkout detected;
- source checkout without CLI returns `SOURCE_FOUND_CLI_NOT_BUILT`;
- missing guest/session token does not require account registration;
- missing guest/session token can return `READY_SESSION_BOOTSTRAP_PENDING`
  when install and provider checks are satisfied;
- missing AI provider returns `AI_PROVIDER_REQUIRED`;
- unavailable runtime provider status returns `AI_PROVIDER_STATUS_UNAVAILABLE`
  instead of falsely reporting missing configuration;
- no secret values are printed.

## Phase 4: User-Approved OpenLoomi Install Flow

Goal: support mentor-requested automatic installation when OpenLoomi is missing,
while keeping the artifact source official and the install path default.

Deliverables:

- `install_openloomi` next action;
- install instructions for unsupported environments;
- user-approved automatic installer flow for supported platforms;
- official artifact source selection;
- version and integrity checks where available;
- post-install `setup-status` recheck.

Acceptance criteria:

- the plugin can detect missing OpenLoomi;
- the user is told what will be installed before installation starts;
- the plugin installs only after an explicit user install intent or
  confirmation;
- supported installers use default installation paths unless the user
  explicitly chooses an interactive/manual path;
- install results are reported as structured status;
- failures return actionable next steps.

## Phase 5: First-Use AI Provider Setup

Goal: guide the user to configure an AI provider for OpenLoomi from the plugin
experience.

Preferred paths:

1. Codex OAuth for Codex subscribers, if an official supported surface is
   available.
2. OpenLoomi-owned secure setup flow for base URL, API key, and model name.
3. OpenLoomi Desktop Settings fallback.

Deliverables:

- `configure_ai_provider` next action;
- provider readiness detection;
- runtime/UI provider readiness detection through OpenLoomi-owned local APIs;
- Codex OAuth feasibility check;
- setup flow for base URL, API key, and model name through OpenLoomi-owned UI
  or CLI surfaces;
- no raw API key exposure in Codex chat.

Acceptance criteria:

- missing provider setup returns `AI_PROVIDER_REQUIRED`;
- UI-saved provider setup is recognized without requiring duplicate env vars;
- provider status reports only masked presence fields, not API key values;
- users can reach an OpenLoomi-owned setup flow from Codex;
- base URL, API key, and model name configuration is supported when OAuth is
  unavailable;
- no API key is passed through argv, stdout, stderr, or Codex transcript;
- Codex receives only success, failure, or readiness state.

## Phase 6: One-Shot Execution

Goal: run a simple task through the local OpenLoomi runtime without requiring
registered-account login when guest mode is available.

Deliverables:

- `run` bridge command;
- guest/session bootstrap through the local OpenLoomi API;
- `initialize-session` bridge command for isolated guest/session setup checks;
- stdin-based prompt passing;
- JSON output handling;
- error normalization for install, session initialization, provider setup, and
  connector blocks.

Execution command:

```bash
openloomi-ctl --one-shot --stdin --json --permission-mode deny
```

Acceptance criteria:

- one-shot prompt succeeds when ready;
- guest users can run through the plugin after OpenLoomi initializes a local
  session token;
- prompt is passed over stdin;
- command arguments do not include secrets or long prompt text;
- JSON output is returned to Codex in a readable form.

## Phase 7: OpenLoomi Skill Guidance

Goal: guide users toward OpenLoomi workflows after the runtime starts.

Deliverables:

- `workflow-guidance` bridge command;
- workflow guidance for `openloomi-loop`;
- workflow guidance for `openloomi-memory`;
- connector readiness guidance;
- handoff workflow guidance;
- thin wrapper skills that call `loomi-bridge`.

Acceptance criteria:

- users can discover OpenLoomi memory and loop workflows from Codex;
- wrapper skills remain thin and delegate to OpenLoomi runtime;
- the plugin does not duplicate connector, memory, or loop implementations;
- connector readiness is reported as status and next action only.

## Phase 8: Optional Codex Hooks and OpenLoomi Pet Notifications

Goal: connect Codex task lifecycle events to OpenLoomi Pet notifications.

Deliverables:

- hook design for task completion;
- hook design for user-input-required states;
- notification payload contract;
- Pet notification routing through OpenLoomi-owned runtime surfaces.

Acceptance criteria:

- Pet can notify when a Codex task completes;
- Pet can notify when Codex needs user input;
- hook payloads do not include secrets;
- hooks are optional and can be disabled.

## Phase 9: Tests and Release Hardening

Goal: make the plugin safe to publish and maintain.

Required tests:

- packaged install detected;
- source checkout detected;
- source checkout without CLI returns `SOURCE_FOUND_CLI_NOT_BUILT`;
- missing install returns `INSTALL_REQUIRED`;
- missing token can be initialized through guest/session bootstrap;
- session bootstrap failure returns `SESSION_INITIALIZATION_REQUIRED`;
- missing AI provider returns `AI_PROVIDER_REQUIRED`;
- UI-saved AI provider returns configured when the OpenLoomi local API is
  reachable;
- unavailable OpenLoomi local API returns `AI_PROVIDER_STATUS_UNAVAILABLE`;
- user-approved install flow can run automatic default-path installation;
- no secret values are printed;
- one-shot prompt succeeds when ready;
- connector missing config returns setup handoff;
- OpenLoomi skill guidance remains wrapper-only;
- optional hooks do not include secrets in payloads.

Release checklist:

- README and roadmap are up to date;
- plugin metadata is valid;
- bridge commands are documented;
- install flow is explicit and user-approved;
- AI provider setup avoids Codex chat secrets;
- Codex OAuth support is documented only after official capability is verified;
- Prettier passes on all plugin docs;
- CI passes.
