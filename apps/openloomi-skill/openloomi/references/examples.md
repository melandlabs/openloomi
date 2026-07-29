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

Respond with the most relevant matches, cite source ids or document ids when present, cite `local-file` paths for local memory-file hits, and say clearly when OpenLoomi returned no matches.

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

## Search Knowledge Base

User request:

```text
Use OpenLoomi to search my uploaded documents for "launch plan".
```

Run:

```bash
node "$SKILL_DIR/scripts/openloomi.cjs" knowledge-search "launch plan" --limit=5
```

Summarize the best matching chunks and preserve document ids when the user may want to open or inspect a document.

## List Knowledge Base Documents

User request:

```text
Use OpenLoomi to list my uploaded documents.
```

Run:

```bash
node "$SKILL_DIR/scripts/openloomi.cjs" knowledge-list --limit=50
```

Return filenames, ids, sizes, upload times, and pagination hints when present.

## Read A Knowledge Base Document

User request:

```text
Use OpenLoomi to read document doc_123.
```

Run:

```bash
node "$SKILL_DIR/scripts/openloomi.cjs" knowledge-get doc_123
```

Summarize the document content and cite the document id.

## Upload To Knowledge Base

User request:

```text
Use OpenLoomi to upload ./notes/project-alpha.md to my knowledge base.
```

First confirm the exact file path and that the user wants to upload it. After confirmation, run:

```bash
node "$SKILL_DIR/scripts/openloomi.cjs" knowledge-upload ./notes/project-alpha.md
```

Report the resulting `documentId`, filename, chunk count, and any upload or embedding error. For files larger than the wrapper limit, tell the user to upload through OpenLoomi Desktop Library.

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
