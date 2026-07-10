---
title: Composio CLI Guide
impact: HIGH
description: Use the Composio CLI to take actions on external apps directly - no code needed
tags: [cli, composio, tools, toolkits, auth, connected-accounts, direct-use]
---

# Composio CLI Guide

Use the Composio CLI to search, connect, and execute tools directly — no code writing required. Ideal for agents taking actions on behalf of the user.

## Prerequisites (first-time setup)

If the CLI is not installed or the user is not authenticated:

```bash
# Install
curl -fsSL https://composio.dev/install | bash
composio --version   # verify

# Authenticate
composio login       # OAuth flow; interactive org/project picker after login (use -y to skip)
composio whoami      # verify org_id, project_id, user_id (API keys are never displayed)
# Run upgrade in case you run into errors or starting with a new project
composio upgrade
```

> **Note**: Use `whoami` only to verify login status — do not hardcode these values in code. `whoami` shows hints for `composio manage orgs switch` and `composio init` when relevant.

**Login behavior**: By default, `composio login` shows an interactive org/project picker after OAuth. Use `composio login -y` to skip the picker and use session defaults. JSON output is emitted only after the picker finishes (or immediately with `-y`), so piped/scripted usage gets the correct `org_id` and `project_id`.

**Agent login (no direct browser access)**: For agents that cannot open a browser for the user, use a two-step flow:

1. **Get login URL and session key** — Print login URL and JSON (jq-parseable) then exit without opening browser or waiting:
   ```bash
   composio login --no-wait | jq
   ```
   Share the login URL with the agent's user to complete login in their browser.

2. **Complete login with session key** — Use the `cli_key` from the previous output to check if the user has logged in:
   ```bash
   composio login --key "<cli_key>"
   ```
   Without `--no-wait`: polls until the session is linked (same as browser flow after printing URL).
   With `--no-wait`: checks once and fails if not linked. For agents, once the user completes login, run with `--no-wait` to avoid blocking.

## Primary Workflow: search → link → execute

### Step 1 — Find the right tool

```bash
composio search "send an email"
composio search "create github issue"
composio search "post slack message"
```

The search results include connection status, so you can see immediately if the user is already connected to the required app.

> **Important**: Do not trim the output of `composio search` (e.g. with `head`). Use the full results to pick the right tool — truncating can hide the best match.

### Step 2 — Connect an account (if needed)

If the user is not connected to the app, link their account:

```bash
composio link gmail
composio link github
composio link slack
```

This opens an OAuth flow or prompts for credentials. Only needed once per app. By default, `composio link` waits until the connected account is ACTIVE (opens browser, polls). Use `--no-wait` for scripted or agent usage: it prints link info and JSON to stdout (JQ-friendly) and exits immediately. Output includes `status`, `connected_account_id`, `redirect_url`, and `toolkit`.

### Step 3 — Execute the tool

```bash
composio execute GMAIL_SEND_EMAIL --data '{"recipient_email":"you@example.com","subject":"Hello","body":"Test"}'
composio execute GITHUB_CREATE_AN_ISSUE --data '{"owner":"acme","repo":"my-repo","title":"Bug report"}'
```
To see a tool's input parameters before executing:
```bash
composio execute GMAIL_SEND_EMAIL --help
```

### Step 4 — Listen for events (optional)

```bash
composio listen
```

Streams real-time trigger events to the terminal.

---

## Tips for Agents

- **All commands output JSON** — pipe to `jq` for filtering and extraction
- **Agent login** — When the agent has no direct browser access, use `composio login --no-wait` to get the URL and key, share the URL with the user, then `composio login --key <key> --no-wait` once they complete login
- **Parallel execution** — use `&` and `wait` or shell scripts for complex multi-step tasks
- The default user context is the project's `test_user_id`. Pass `--user-id <id>` to act on behalf of a specific user.

```bash
composio execute GMAIL_SEND_EMAIL --user-id "user_123" --data '{"recipient_email":"them@example.com","subject":"Hi"}'
```

## Best Practices

1. **Use `jq` for JSON** — Pipe CLI output to `jq` for filtering and extraction instead of parsing raw JSON.
2. **Control output at source** — When fetching large amounts of data, use the tool's filters (if supported) to limit what is returned.
3. **Offload analysis** — After understanding the schema, use inline bash scripts for heavy data analysis instead of manual inspection. Avoid using composio SDK for personal usecases only use the SDKs when building apps.
4. **Parallelize independent actions** — For tools/actions that don't depend on each other, run them in parallel with `&` and `wait`. Use `xargs -P` or `parallel` only when the backend can handle the load.
5. **Avoid large terminal dumps** — Filter, search, and summarize instead of outputting full datasets:
   - Quick text filtering: `grep -E`, `rg` (ripgrep), `awk`, `sed`
   - Summarize: `sort | uniq -c | sort -nr`, `wc -l`, `head`, `tail`
   - For large output: `less`, `lnav` (logs), `tail -f` for streaming
6. **Minimize file creation** — Use ephemeral files only when needed; create files only when the user explicitly asks.
7. **Respect rate limits** — Be mindful of pagination and API/CLI rate limits when parallelizing.
8. **Never invent tool slugs or app names** — Only use tools returned by `composio search`. For app names, use `composio manage toolkits info <slug>` or `composio manage tools info <tool>` to verify.
9. **Do not trim `composio search` output** — Never pipe search results through `head`, `tail`, or similar. Use the full output to find the best tool match.

---

## Advanced Commands

### Discover Tools (when search isn't enough)

```bash
# List all toolkits
composio manage toolkits list

# Get details about a specific toolkit
composio manage toolkits info "gmail"

# List tools in a toolkit
composio manage tools list --toolkits "gmail"

# Get a tool's full schema
composio manage tools info "GMAIL_SEND_EMAIL"
```

### Connected Accounts

```bash
# List active connections
composio manage connected-accounts list --status ACTIVE

# Link an account (full form with options)
composio manage connected-accounts link --auth-config "ac_..." --user-id "user_123"

# Delete a connection
composio manage connected-accounts delete <id>
```

### Auth Configs

> Only needed when building apps with custom OAuth credentials. For personal use and agents, `composio link` handles this automatically.

```bash
composio manage auth-configs list --toolkits "gmail"
composio manage auth-configs create
composio manage auth-configs info <id>
composio manage auth-configs delete <id>
```

### Triggers

```bash
# List available trigger types
composio manage triggers list
composio manage triggers info "GMAIL_NEW_GMAIL_MESSAGE"

# Manage trigger instances
composio manage triggers create <trigger-name>
composio manage triggers enable <id>
composio manage triggers disable <id>
composio manage triggers status
```

### Debugging & Logs

```bash
# View recent tool executions
composio manage logs tools

# Get detailed logs for a specific execution
composio manage logs tools "log_abc123"

# Monitor trigger events
composio manage logs triggers
```
---

## jq Examples

```bash
# Extract toolkit slugs
composio manage toolkits list | jq -r '.[].slug'

# Get tool names from a toolkit
composio manage tools list --toolkits "gmail" | jq -r '.[].name'

# Filter active connections
composio manage connected-accounts list --status ACTIVE | jq -r '.[].id'

# Extract login URL and key from agent login flow
composio login --no-wait | jq -r '.login_url'
composio login --no-wait | jq -r '.key'
```

## Command Help

Every command supports `--help` for detailed options:

```bash
composio --help
composio login --help
composio search --help
composio execute --help
composio link --help
composio listen --help
composio manage tools --help
composio manage toolkits --help
composio manage triggers --help
```
