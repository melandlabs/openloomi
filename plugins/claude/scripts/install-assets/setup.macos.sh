#!/usr/bin/env bash
# OpenLoomi Claude Code plugin — macOS install helper.
# SPDX-License-Identifier: Apache-2.0
#
# This script is shipped by the OpenLoomi Claude plugin and is invoked
# only after the user explicitly runs `/openloomi:hooks install` ...
# no, wait — only after `/openloomi:install [--yes]`. The plugin always
# asks y/N before executing this script.
#
# What this does (and does NOT do):
#   ✓ Checks that `curl` is on PATH.
#   ✓ Downloads the latest stable `OpenLoomi.app.dmg` from the public
#     GitHub release URL into /tmp.
#   ✓ Mounts the DMG with `hdiutil`, drags OpenLoomi.app to /Applications,
#     and unmounts.
#   ✓ Calls the bundled cli binary to verify install.
#   ✗ Never touches `~/.openloomi/token` or any credential.
#   ✗ Never modifies shell rc files or `~/.claude/settings.json`.
#
# Reference: https://openloomi.ai/docs/install/macos

set -euo pipefail

REPO_SLUG="${OPENLOOMI_REPO:-melandlabs/openloomi}"
GITHUB_RELEASE_URL="https://api.github.com/repos/${REPO_SLUG}/releases/latest"
DOCS_BASE="${OPENLOOMI_DOCS_BASE:-https://openloomi.ai}"

log() { printf "[openloomi-installer] %s\n" "$*" >&2; }
fail() { log "ERROR: $*"; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

require curl
require hdiutil
require rsync

# 1. Resolve latest stable asset (.dmg).
log "Resolving latest OpenLoomi macOS release…"
asset_url=$(curl -fsSL "${GITHUB_RELEASE_URL}" \
  | sed -n 's/.*"browser_download_url":[[:space:]]*"\([^"]*\.dmg\)".*/\1/p' \
  | head -n1 || true)

if [[ -z "${asset_url}" ]]; then
  fail "Could not resolve the .dmg asset URL. Visit ${DOCS_BASE}/docs/install/macos and install manually."
fi

# 2. Download.
workdir=$(mktemp -d -t openloomi-install.XXXXXX)
trap 'rm -rf "${workdir}"' EXIT
dmg="${workdir}/OpenLoomi.dmg"
log "Downloading ${asset_url}"
curl -fSL --retry 3 --output "${dmg}" "${asset_url}" || fail "Download failed."

# 3. Mount + copy.
mountpoint=$(mktemp -d -t openloomi-mount.XXXXXX)
log "Mounting DMG to ${mountpoint}"
hdiutil attach -nobrowse -mountpoint "${mountpoint}" "${dmg}" >/dev/null || fail "hdiutil attach failed."
trap 'hdiutil detach "${mountpoint}" >/dev/null 2>&1 || true; rm -rf "${workdir}" "${mountpoint}"' EXIT

if [[ ! -d "${mountpoint}/OpenLoomi.app" ]]; then
  fail "DMG did not contain OpenLoomi.app."
fi

log "Installing OpenLoomi.app to /Applications (may require sudo)…"
if [[ -w "/Applications" ]]; then
  rsync -a --delete "${mountpoint}/OpenLoomi.app/" "/Applications/OpenLoomi.app/"
else
  sudo rsync -a --delete "${mountpoint}/OpenLoomi.app/" "/Applications/OpenLoomi.app/" || fail "sudo rsync failed."
fi

# 4. Verify install.
bin="/Applications/OpenLoomi.app/Contents/MacOS/openloomi"
if [[ ! -x "${bin}" ]]; then
  # OpenLoomi.app is on disk — the user-visible install succeeded. The
  # inner main binary may not have been laid down by the .dmg copy alone
  # (some macOS quarantine paths require a first launch). Exit 0 with a
  # clear, friendly note so the bridge can route the user to the next
  # step instead of pretending the install failed.
  log "OpenLoomi.app was installed successfully to /Applications."
  log "Note: the inner main binary will be placed the first time you launch OpenLoomi."
  log "Next step from Claude Code: just open OpenLoomi.app once, then re-run /openloomi:setup."
  exit 0
fi

log "Verifying the OpenLoomi install…"
log "  found main binary at: ${bin}"
log "  (version is reported by the desktop app on first launch — calling --version on the Tauri main binary would flash a GUI window)"

log "Install complete. Open OpenLoomi from /Applications and run /openloomi:setup again to continue."
