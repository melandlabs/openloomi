# OpenLoomi Standalone CLI

OpenLoomi releases include standalone CLI archives for CI/CD and scripted automation. Download the archive for your platform from the GitHub release page, extract it, and run `openloomi-ctl` from the extracted directory.

## Release Artifacts

- Windows x64: `openloomi-ctl-windows-x64.zip`
- macOS Apple Silicon: `openloomi-ctl-macos-arm64.tar.gz`
- macOS Intel: `openloomi-ctl-macos-x64.tar.gz`
- Linux x64: `openloomi-ctl-linux-x64.tar.gz`
- Linux arm64: `openloomi-ctl-linux-arm64.tar.gz`

Each archive contains `openloomi-ctl` or `openloomi-ctl.exe`, packaged direct runner resources under `resources/.next/standalone`, `cli-bundle/native-agent-cli.cjs`, and an archive-local `README.md`.

## Runtime Requirement

The standalone CLI artifact does not bundle Node.js. Install Node.js 22 or newer and ensure `node` is on `PATH`. If Node.js is missing, packaged one-shot mode exits with a clear error explaining the Node.js 22+ requirement.

## Basic Usage

Windows:

```powershell
Expand-Archive .\openloomi-ctl-windows-x64.zip -DestinationPath .\openloomi-ctl
cd .\openloomi-ctl
.\openloomi-ctl.exe --version
set OPENLOOMI_AUTH_TOKEN=your-token
.\openloomi-ctl.exe --one-shot "Reply with exactly: OK" --json --permission-mode deny
type prompt.txt | .\openloomi-ctl.exe --one-shot --stdin --json --permission-mode deny
```

macOS and Linux:

```bash
tar -xzf openloomi-ctl-linux-x64.tar.gz -C openloomi-ctl
cd openloomi-ctl
./openloomi-ctl --version
export OPENLOOMI_AUTH_TOKEN=your-token
./openloomi-ctl --one-shot "Reply with exactly: OK" --json --permission-mode deny
cat prompt.txt | ./openloomi-ctl --one-shot --stdin --json --permission-mode deny
```

Use `--permission-mode deny` for non-interactive CI by default. Use `--permission-mode bypass` only in trusted automation.

## CI/CD Example

Install Node.js 22 or newer in CI before running the extracted CLI. For GitHub Actions:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
```

```bash
curl -L -o openloomi-ctl-linux-x64.tar.gz \
  "https://github.com/melandlabs/openloomi/releases/download/v${OPENLOOMI_VERSION}/openloomi-ctl-linux-x64.tar.gz"
mkdir -p openloomi-ctl
tar -xzf openloomi-ctl-linux-x64.tar.gz -C openloomi-ctl
export OPENLOOMI_AUTH_TOKEN="${OPENLOOMI_AUTH_TOKEN}"
./openloomi-ctl/openloomi-ctl --one-shot "Reply with exactly: OK" --json --permission-mode deny
```

Set `OPENLOOMI_API_URL` only when you intentionally want the HTTP compatibility path to a running OpenLoomi API service. Without `OPENLOOMI_API_URL`, release builds use the packaged direct native-agent runner.
