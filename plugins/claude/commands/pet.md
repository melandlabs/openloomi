---
description: Set the OpenLoomi Pet to a specific state (theme-agnostic; fox sprite set active by default)
argument-hint: "<state>"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs *)
---

# /openloomi:pet <state>

Valid states: `happy`, `idle`, `juggling`, `needsinput`, `presenting`,
`sleeping`, `sweeping`, `thinking`, `working`.

Run:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs pet <state>
```

- If the state is invalid, the bridge returns
  `{ok: false, code: "INVALID_STATE", validStates: [...]}`.
- If the `POST /api/pet/state` endpoint is not yet exposed by OpenLoomi,
  the bridge returns `{ok: false, code: "ENDPOINT_MISSING", ...}` with a
  polite notice. Treat that as a non-blocking outcome for the user.

Tips:

- Manual `idle`, `sleeping`, `sweeping`, `presenting` are managed by the
  loop watcher — changing them from Claude will be quickly overridden.
- Hooks handle automatic state transitions; `/openloomi:pet` is for
  explicit user-driven overrides.
