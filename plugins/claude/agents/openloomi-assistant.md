---
name: openloomi-assistant
description: "Sub-agent reserved for Phase 9. Delegates anything OpenLoomi-related to the `openloomi` skill — never duplicates connector, memory, or loop business logic."
metadata:
  version: 0.1.0
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs *)
---

# OpenLoomi Assistant (sub-agent, Phase 9)

This file is the placeholder for the optional sub-agent. When enabled, it
serves as a thin wrapper that routes any user request mentioning OpenLoomi
into the `openloomi` skill — never re-implementing connector, memory, or
loop logic in the sub-agent itself.

It is intentionally disabled in Phase 2 (MVP). Phase 9 enables it after
the parent `openloomi` skill has stabilised.
