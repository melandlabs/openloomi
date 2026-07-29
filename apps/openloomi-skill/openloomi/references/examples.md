# OpenLoomi Skill Examples

Use these examples as task patterns for skill-based hosts such as WorkBuddy. Prefer structured command output from the wrapper, then explain the result in plain language.

## Search Memory

User request:

```text
Use OpenLoomi to search my memory for "internship project".
```

Run:

```bash
node "$SKILL_DIR/scripts/openloomi.cjs" memory-search "internship project" --limit=5
```

Respond with the most relevant matches, cite source ids or document ids when present, and say clearly when OpenLoomi returned no matches.

## Check Connectors

User request:

```text
Use OpenLoomi to list my connected accounts.
```

Run:

```bash
node "$SKILL_DIR/scripts/openloomi.cjs" connectors-list
```

Summarize connected platforms and preserve ids such as `accountId` or `botId` when the user may need them for a later action.

## Draft An Email

User request:

```text
Use OpenLoomi to draft an email to Alice about tomorrow's sync. Do not send it.
```

Run:

```bash
node "$SKILL_DIR/scripts/openloomi.cjs" agent-run "Draft an email to Alice about tomorrow's sync. Do not send it."
```

Return the draft. Do not send the email unless the user explicitly asks and confirms.

## Post To Slack

User request:

```text
Use OpenLoomi to draft a Slack reply to the design channel about the timeline.
```

Run:

```bash
node "$SKILL_DIR/scripts/openloomi.cjs" agent-run "Draft a Slack reply to the design channel about the timeline. Do not send it without confirmation."
```

If the user asks to send, confirm the exact destination and message text before triggering any side effect.

## Summarize A Notion Page

User request:

```text
Use OpenLoomi to summarize the Notion page about the launch plan.
```

Run:

```bash
node "$SKILL_DIR/scripts/openloomi.cjs" agent-run "Summarize the Notion page about the launch plan using OpenLoomi connected context."
```

If Notion is not connected, report the connector gap and suggest opening OpenLoomi Desktop connectors.
