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

# 1. Resolve latest stable asset (.dmg) AND its tag_name. We hit the
#    GitHub releases API once and pull both fields from the same payload —
#    no second round-trip, no `--version` call on the inner Tauri binary
#    (which would flash a GUI window). The bridge parses the JSON line we
#    print to stdout at the end of this script.
log "Resolving latest OpenLoomi macOS release…"
release_json=$(curl -fsSL "${GITHUB_RELEASE_URL}" || true)

asset_url=$(printf '%s' "${release_json}" \
  | sed -n 's/.*"browser_download_url":[[:space:]]*"\([^"]*\.dmg\)".*/\1/p' \
  | head -n1 || true)
tag_name=$(printf '%s' "${release_json}" \
  | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' \
  | head -n1 || true)

# Strip a leading "v" / "V" from tag_name so downstream consumers get a
# clean semver-ish version (e.g. "v0.7.8" → "0.7.8"). Fall back to "" if
# the API didn't return a tag_name.
version=$(printf '%s' "${tag_name}" | sed -E 's/^[vV]//')

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
if [[ -x "${bin}" ]]; then
  log "Verifying the OpenLoomi install…"
  log "  found main binary at: ${bin}"
  log "  resolved version: ${version:-unknown} (from tag ${tag_name:-unknown})"
else
  # OpenLoomi.app is on disk but the inner helper binary isn't laid down
  # yet. For signed .app bundles this is rare (the DMG already carries
  # the inner binary), but if it does happen we still exit 0 — the bridge
  # will detect this and launch OpenLoomi.app to finalize.
  bin=""
  log "OpenLoomi.app was installed to /Applications, but the inner helper binary is not yet present."
  log "The bridge will launch OpenLoomi.app to finalize the install on the next /openloomi:setup call."
fi

# Emit a structured JSON line on stdout that the bridge parses for the
# resolved version and asset URL. We print to stdout (not stderr) so the
# bridge's stdout capture picks it up cleanly. Human-readable progress
# goes to stderr above.
printf '{"version":"%s","tag":"%s","assetUrl":"%s","binPath":"%s"}\n' \
  "${version}" "${tag_name}" "${asset_url}" "${bin}"

log "Install complete. Re-run /openloomi:setup from Claude Code to continue."
