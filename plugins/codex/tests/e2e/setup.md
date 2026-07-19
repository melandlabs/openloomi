# OpenLoomi Codex Plugin E2E Checklist

This checklist is for human-run validation of the Codex plugin. It separates
the normal user path from the source-development path so temporary environment
variables do not leak into ordinary setup instructions.

## A. Normal User Smoke Test

Prerequisites:

- OpenLoomi Desktop is installed or the user is willing to approve the plugin's
  official installer flow.
- Codex can load the OpenLoomi plugin from a marketplace or local checkout.

Steps:

1. Start a new Codex thread after installing or refreshing the plugin cache.
2. Ask: `@OpenLoomi Check whether OpenLoomi is ready.`
3. Expected: the plugin calls `setup-status` and reports stable JSON fields:
   `installed`, `appPath`, `tokenPresent`, `apiReachable`, `ready`,
   `nextAction`, and `reason`.
4. If `nextAction` is `open_openloomi`, open OpenLoomi Desktop and ask again.
5. Ask: `@OpenLoomi Show the OpenLoomi workflows available from Codex.`
6. Expected: Codex lists `openloomi-loop`, `openloomi-memory`,
   `openloomi-connectors`, and `openloomi-handoff`.
7. Ask a minimal handoff prompt: `@OpenLoomi Reply with exactly: OpenLoomi ready.`
8. Expected: Codex routes through the OpenLoomi handoff skill and the local
   runtime returns a structured result or runtime error. It must not ask the
   user to paste API keys or tokens into Codex chat.

## B. Source Development E2E

Use this path when testing against a source checkout with `pnpm tauri:dev`.
These variables are a dev harness, not the normal user flow.

Terminal A:

```powershell
cd <openloomi-repo>

$env:OPENLOOMI_AGENT_PROVIDER = "codex"
$env:OPENLOOMI_AGENT_CODEX_COMMAND = "$HOME\.codex\plugins\.plugin-appserver\codex.exe"
$env:OPENLOOMI_AGENT_CODEX_TIMEOUT_MS = "180000"
$env:OPENLOOMI_AGENT_CODEX_SANDBOX = "workspace-write"
$env:OPENLOOMI_AGENT_CODEX_SKIP_GIT_REPO_CHECK = "1"

pnpm tauri:dev *> plugins\codex\tests\logs\tauri-dev-local.log
```

Terminal B:

```powershell
cd <openloomi-repo>
$repo = (Resolve-Path .).Path

$env:OPENLOOMI_APP = Join-Path $repo "apps\web\src-tauri\target\release\openloomi.exe"
$env:OPENLOOMI_BASE_URL = "http://localhost:3515"

node plugins\codex\scripts\loomi-bridge.mjs initialize-session
node plugins\codex\scripts\loomi-bridge.mjs setup-status
"Reply with exactly: OpenLoomi ready." | node plugins\codex\scripts\loomi-bridge.mjs workflow-guidance
```

Expected:

- `initialize-session` reports `SESSION_READY`.
- `setup-status` reports `apiReachable: true` and `apiBaseUrl:
"http://localhost:3515"` when the dev API is up.
- `workflow-guidance` returns the local-API-aware handoff recipes when the
  API is reachable.
- The local API URL is consumed by the OpenLoomi Desktop runtime without
  requiring the user to set it manually in Codex.

## C. Logs

Temporary logs may be written under:

```text
plugins/codex/tests/logs/
```

Do not commit files from that directory. If needed, exclude them locally:

```powershell
Add-Content .git\info\exclude "plugins/codex/tests/logs/"
```

`.git/info/exclude` is local-only and is not pushed to the remote repository.

## D. Focused Test Command

```powershell
node --test plugins\codex\tests\bridge.test.mjs
```

The unit test suite uses fake homes, fake OpenLoomi Desktop app shims, and
local closed API URLs so it does not depend on the developer's real OpenLoomi
token, default install path, or Desktop process.
