# OpenLoomi Skill Tool Surface

This reference defines the Option B skill-bundle command contract. The wrapper implementation should stay thin and call the local OpenLoomi Desktop API; OpenLoomi remains the owner of memory, connector credentials, agent execution, and side effects.

The command implementation lives at `scripts/openloomi.cjs`.

## Runtime Discovery

Resolve the local API base URL in this order:

1. `OPENLOOMI_API_URL`
2. `OPENLOOMI_BASE_URL`
3. `http://127.0.0.1:3414`
4. `http://127.0.0.1:3515`
5. `http://127.0.0.1:3415`

Resolve auth in this order:

1. `OPENLOOMI_AUTH_TOKEN`
2. Base64-decoded home directory `.openloomi/token`

Never print raw tokens, API keys, OAuth secrets, app passwords, secure-storage values, or Authorization headers.

## Commands

All commands should print JSON to stdout. Error responses should include `ok: false`, `code`, and `message`.

### status

Check whether the local OpenLoomi API is reachable and whether an auth token is available.

```bash
node "$SKILL_DIR/scripts/openloomi.cjs" status
```

Expected API probes:

- `GET /api/remote-auth/user`
- optionally `GET /api/native/providers`

### memory-search

Search OpenLoomi memory and knowledge surfaces for user context.

```bash
node "$SKILL_DIR/scripts/openloomi.cjs" memory-search "project alpha" --limit=5
```

Preferred API path:

- `POST /api/memory/search` with `{ "query": "...", "limit": 5 }`

Fallback API path:

- `POST /api/rag/search` with `{ "query": "...", "limit": 5 }`

### connectors-list

List connected accounts and return account ids, platforms, display names, statuses, and bot ids when available.

```bash
node "$SKILL_DIR/scripts/openloomi.cjs" connectors-list
```

Preferred API path:

- `GET /api/integrations/accounts`

Optional filter:

- `--platform=gmail` returns only matching accounts while preserving the full API result under `result`.

### agent-run

Trigger the local OpenLoomi native agent for complex cross-app work, drafts, summaries, and actions that should remain inside OpenLoomi-owned runtime logic.

```bash
node "$SKILL_DIR/scripts/openloomi.cjs" agent-run "Draft an email to Alice about tomorrow's sync. Do not send it."
```

Preferred API path:

- `POST /api/native/agent`

The wrapper should collect the final SSE result into a concise JSON object. It should not stream raw internal events unless a debug flag is explicitly added later.

Default request policy:

- `platform: "workbuddy"` unless `--platform=<name>` is passed.
- `permissionMode: "dontAsk"`.
- `Edit`, `Write`, `Bash`, `Agent`, and `Task` are explicitly disallowed.
- `Read`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, `Skill`, `LSP`, and `TodoWrite` remain allowed for read, retrieval, planning, and skill-driven draft workflows.

## Side-Effect Policy

Treat these operations as requiring explicit user confirmation:

- Send a message or email.
- Schedule or execute a Loop action.
- Delete or disconnect any account, memory, document, or artifact.
- Upload a document to the knowledge base.
- Trigger an agent task that can write to external systems.

Search, status checks, summaries, drafts, and connector listing are allowed as read-only operations.

## Reuse Sources

Use these existing repo resources as the implementation source of truth when you build `scripts/openloomi.cjs`:

- `plugins/codex/skills/openloomi-memory/scripts/openloomi-memory.cjs` for token loading, port fallback, local memory search, knowledge-base search, and search aggregation.
- `plugins/codex/skills/openloomi-connectors/scripts/openloomi-connectors.cjs` for account listing, platform status, and connector response shaping.
- `apps/web/src-tauri/src/cli.rs` and `benchmark/beam/src/memory-adapter.ts` for `/api/native/agent` request shape and SSE result parsing.
- `plugins/codex/scripts/loomi-bridge.mjs` for `/api/native/providers` probing and host-side readiness fallback.
- `plugins/codex/skills/openloomi-api/SKILL.md` for the canonical endpoint catalogue when a route needs confirmation.
