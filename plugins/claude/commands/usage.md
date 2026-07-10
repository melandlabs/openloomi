---
description: Show today's LLM usage summary as recorded by OpenLoomi
argument-hint: ""
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs *)
---

# /openloomi:usage

Run:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs usage
```

Print the resulting JSON to the user. Key fields typically include
`configured`, `today`, `total`, `last7d`. If the API is unreachable the
bridge returns `code: "API_UNREACHABLE"` — surface that and prompt the
user to start OpenLoomi Desktop.
