# OpenLoomi WorkBuddy Skill Bundle

This directory contains the uploadable OpenLoomi skill bundle for skill-based agent hosts such as WorkBuddy. It implements issue #321 Option B only: a Skill Bundle that routes requests to the local OpenLoomi Desktop API.

## Upload

Upload the `apps/openloomi-skill/openloomi/` folder, or create a zip from that folder's contents:

```powershell
Compress-Archive -Path apps\openloomi-skill\openloomi\* -DestinationPath openloomi-skill.zip -Force
```

The zip root must contain:

- `SKILL.md`
- `agents/openai.yaml`
- `scripts/openloomi.cjs`
- `references/examples.md`
- `references/tool-surface.md`

Do not include `apps/openloomi-skill/tests/` or this README in the uploaded bundle.

## Runtime Requirements

OpenLoomi Desktop must be running locally before the skill can reach memory, connectors, or native agent workflows. The wrapper tries these local API bases in order unless overridden:

1. `OPENLOOMI_API_URL`
2. `OPENLOOMI_BASE_URL`
3. `http://127.0.0.1:3414`
4. `http://127.0.0.1:3515`
5. `http://127.0.0.1:3415`

Authentication is resolved from `OPENLOOMI_AUTH_TOKEN`, then from the base64 token file at `~/.openloomi/token`. Never paste tokens, OAuth secrets, API keys, or app passwords into chat.

## WorkBuddy Smoke

After uploading the bundle, start a WorkBuddy chat and try:

```text
Use $openloomi to check my local OpenLoomi status.
```

```text
Use $openloomi to list my connected accounts.
```

```text
Use $openloomi to search memory for "project alpha".
```

```text
Use $openloomi to list my uploaded OpenLoomi documents.
```

Expected behavior:

- `status` reports the discovered local API URL, auth availability, and provider probe status.
- `connectors-list` returns connected accounts or a clear empty state.
- `memory-search` returns matching OpenLoomi memory/RAG results or a clear no-results message.
- `knowledge-list` returns uploaded document ids, filenames, and pagination details or a clear empty state.
- If OpenLoomi Desktop is closed or setup is incomplete, the skill reports the local API or auth problem without inventing data.

## Local Validation

Run these checks before packaging:

```powershell
$env:PYTHONUTF8='1'
python skills\skill-creator\scripts\quick_validate.py apps\openloomi-skill\openloomi
node --test apps\openloomi-skill\tests\bundle-structure.test.mjs
node --test apps\openloomi-skill\tests\openloomi-script.test.mjs
pnpm exec prettier --check apps/openloomi-skill/README.md apps/openloomi-skill/openloomi/SKILL.md apps/openloomi-skill/openloomi/agents/openai.yaml apps/openloomi-skill/openloomi/references/tool-surface.md apps/openloomi-skill/openloomi/references/examples.md apps/openloomi-skill/openloomi/scripts/openloomi.cjs apps/openloomi-skill/tests/openloomi-script.test.mjs apps/openloomi-skill/tests/bundle-structure.test.mjs
```

Optional zip smoke on Windows:

```powershell
$zip = Join-Path $env:TEMP ("openloomi-skill-" + [guid]::NewGuid().ToString() + ".zip")
Compress-Archive -Path apps\openloomi-skill\openloomi\* -DestinationPath $zip -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
try { $archive.Entries | Select-Object FullName, Length } finally { $archive.Dispose() }
Write-Output "ZIP_PATH=$zip"
```
