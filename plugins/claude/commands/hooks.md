---
description: Install, uninstall, or inspect OpenLoomi's Claude Code hooks
argument-hint: "[install|uninstall|status]"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs *)
---

# /openloomi:hooks [install|uninstall|status]

The plugin never auto-installs hooks. Choose a subcommand:

| Subcommand  | Bridge call       | Effect                                                                                          |
| ----------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| `install`   | `install-hooks`   | Merges the plugin's hook block into `~/.claude/settings.json` (preserves other plugins' hooks). |
| `uninstall` | `uninstall-hooks` | Removes only the plugin's block; idempotent.                                                    |
| `status`    | `hooks-status`    | Reports whether the block is currently installed.                                               |

Default (no argument) runs `status`.

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs install-hooks
node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs uninstall-hooks
node ${CLAUDE_PLUGIN_ROOT}/scripts/loomi-bridge.mjs hooks-status
```

The bridge runs merge-no-overwrite and is atomic. The Stop hook always
exits 0; archive failures never block Claude Code.
