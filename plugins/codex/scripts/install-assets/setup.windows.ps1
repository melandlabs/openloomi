# OpenLoomi Codex plugin - Windows install helper.
# SPDX-License-Identifier: Apache-2.0
#
# Invoked by loomi-bridge.installOpenLoomi only after the user explicitly
# runs `install-openloomi --confirm`. The codex bridge has already
# resolved the latest official Windows asset, verified its SHA-256 against
# the GitHub release digest, and downloaded it into a temp file. It then
# passes that local file path as the first argument to this script.
#
# This script's job is purely the OS-level install. It dispatches on the
# downloaded artifact's extension:
#   .msi -> msiexec /i <artifact> /qn /norestart (elevated)
#   .exe -> <artifact> /S            (NSIS silent, default path)
#
# Companion to plugins/claude/scripts/install-assets/setup.windows.ps1 -
# kept structurally aligned. Real differences:
#   - This script does NOT call the GitHub Releases API or use winget.
#     The codex bridge already resolved + downloaded the official artifact
#     and picked the right one for the host before us.
#   - We require the artifact path as the first parameter instead of
#     deriving it.
#   - We emit a single structured JSON line on stdout describing the
#     installed binary path, so the bridge can attach it to the install
#     record (version / tag / assetUrl come from the bridge's earlier
#     resolution, not from this script).
#
# Reference: https://openloomi.ai/docs/install/windows

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string] $Artifact
)

$ErrorActionPreference = "Stop"

$DocsBase = if ($env:OPENLOOMI_DOCS_BASE) { $env:OPENLOOMI_DOCS_BASE } else { "https://openloomi.ai" }

function Log($msg)  { Write-Host "[openloomi-installer] $msg" -ForegroundColor Cyan }
function Fail($msg) { Log "ERROR: $msg"; exit 1 }

if (-not (Test-Path $Artifact)) {
  Fail "Artifact not found at: $Artifact"
}

$ext = [System.IO.Path]::GetExtension($Artifact).ToLowerInvariant()

switch ($ext) {
  ".msi" {
    Log "Running MSI installer (elevated)..."
    $proc = Start-Process -FilePath "msiexec.exe" `
      -ArgumentList @("/i", "`"$Artifact`"", "/qn", "/norestart") `
      -Verb RunAs -Wait -PassThru
    if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
      Fail "MSI installer exited with code $($proc.ExitCode)."
    }
  }
  ".exe" {
    Log "Running NSIS installer (silent, default path)..."
    $proc = Start-Process -FilePath $Artifact -ArgumentList @("/S") -Wait -PassThru
    if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
      Fail "Installer exited with code $($proc.ExitCode)."
    }
  }
  default {
    Fail "Unsupported Windows artifact type: $Artifact. Install manually from $DocsBase/docs/install/windows."
  }
}

# Resolve the installed main binary. Prefer %LOCALAPPDATA%\OpenLoomi, then PATH.
$bin = Join-Path $env:LOCALAPPDATA "OpenLoomi\openloomi.exe"
if (-not (Test-Path $bin)) {
  $cmd = Get-Command openloomi.exe -ErrorAction SilentlyContinue
  if ($cmd) { $bin = $cmd.Source }
}

if (-not $bin -or -not (Test-Path $bin)) {
  # Files were installed but the main binary isn't placed yet - the
  # desktop app's first launch does this. Report an empty binPath so the
  # bridge can guide the user, instead of failing.
  $bin = ""
  Log "OpenLoomi was installed, but the main binary is not on PATH or in %LOCALAPPDATA%\OpenLoomi yet."
  Log "Launch the OpenLoomi desktop app once so it places the main binary,"
  Log "then re-run setup-status from the Codex plugin to finish setup."
} else {
  Log "Verifying the OpenLoomi install..."
  Log "  found main binary at: $bin"
}

# Emit a single structured JSON line on stdout for the bridge. The bridge
# already knows version / tag / assetUrl from its earlier GitHub release
# resolution; we only report what this script verified on disk (binPath).
$installRecord = [PSCustomObject]@{
  binPath  = $bin
  version  = ""
  tag      = ""
  assetUrl = ""
}
Write-Output ($installRecord | ConvertTo-Json -Compress)

Log "Install complete. Re-run setup-status to continue."
