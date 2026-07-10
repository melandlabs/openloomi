# OpenLoomi Claude Code plugin — Windows install helper.
# SPDX-License-Identifier: Apache-2.0
#
# Invoked only after the user explicitly runs
# `node loomi-bridge.mjs install [--yes]`. Never auto-executed.
#
# Strategy:
#   • Detect winget, then try to install via winget if available.
#   • Else download the latest .msi from the GitHub releases.
#   • Verify by running the installed helper CLI's --version.
#
# Reference: https://openloomi.ai/docs/install/windows

$ErrorActionPreference = "Stop"

$Repo        = if ($env:OPENLOOMI_REPO) { $env:OPENLOOMI_REPO } else { "melandlabs/openloomi" }
$ReleaseUrl  = "https://api.github.com/repos/$Repo/releases/latest"
$DocsBase    = if ($env:OPENLOOMI_DOCS_BASE) { $env:OPENLOOMI_DOCS_BASE } else { "https://openloomi.ai" }

function Log($msg)    { Write-Host "[openloomi-installer] $msg" -ForegroundColor Cyan }
function Fail($msg)   { Log "ERROR: $msg"; exit 1 }

# 1. Prefer winget
$winget = Get-Command winget -ErrorAction SilentlyContinue
if ($winget) {
  Log "Installing via winget (id: OpenLoomi.OpenLoomi)…"
  try {
    winget install --id OpenLoomi.OpenLoomi --silent --accept-package-agreements --accept-source-agreements
    $bin = (Get-Command openloomi.exe -ErrorAction SilentlyContinue)?.Source
    if (-not $bin) {
      $candidate = Join-Path $env:LOCALAPPDATA "OpenLoomi\openloomi.exe"
      if (Test-Path $candidate) { $bin = $candidate }
    }
    if ($bin) {
      Log "Verifying the OpenLoomi install…"
      Log "  found main binary at: $bin"
      Log "  (version is reported by the desktop app on first launch — calling --version on the Tauri main binary would flash a GUI window)"
      Log "Install complete. Re-run /openloomi:setup to continue."
      exit 0
    }
  } catch {
    Log "winget install failed; falling back to direct .msi download."
  }
}

# 2. Fallback: download MSI
Log "Resolving latest OpenLoomi Windows release…"
$release   = Invoke-RestMethod -Uri $ReleaseUrl -Headers @{ "User-Agent" = "openloomi-claude-plugin" }
$msiAsset  = $release.assets | Where-Object { $_.name -like "OpenLoomi-Setup-*.msi" } | Select-Object -First 1
if (-not $msiAsset) {
  Fail "No MSI asset found. Visit $DocsBase/docs/install/windows and install manually."
}

$workdir   = Join-Path ([System.IO.Path]::GetTempPath()) ("openloomi-install-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $workdir | Out-Null
$msi       = Join-Path $workdir $msiAsset.name

Log "Downloading $($msiAsset.browser_download_url)"
Invoke-WebRequest -Uri $msiAsset.browser_download_url -OutFile $msi -UseBasicParsing

Log "Running installer (elevated)…"
$proc = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/i", "`"$msi`"", "/qn", "/norestart") -Verb RunAs -Wait -PassThru
if ($proc.ExitCode -ne 0) {
  Fail "MSI installer exited with code $($proc.ExitCode)."
}

$bin = Join-Path $env:LOCALAPPDATA "OpenLoomi\openloomi.exe"
if (-not (Test-Path $bin)) {
  $bin = (Get-Command openloomi.exe -ErrorAction SilentlyContinue)?.Source
}
if (-not $bin -or -not (Test-Path $bin)) {
  Fail "Install completed but the OpenLoomi main binary is not on PATH or in %LOCALAPPDATA%\OpenLoomi. Open OpenLoomi once to finalize."
}

Log "Verifying the OpenLoomi install…"
Log "  found main binary at: $bin"
Log "  (version is reported by the desktop app on first launch — calling --version on the Tauri main binary would flash a GUI window)"
Log "Install complete. Re-run /openloomi:setup to continue."
