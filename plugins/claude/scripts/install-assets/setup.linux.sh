#!/usr/bin/env bash
# OpenLoomi Claude Code plugin — Linux install helper.
# SPDX-License-Identifier: Apache-2.0
#
# Invoked only after the user explicitly runs
# `node loomi-bridge.mjs install [--yes]`. Never auto-executed.
#
# Strategy:
#   • Try the official .deb / .rpm / AppImage asset attached to the latest
#     stable GitHub release. Pick whichever matches the host's package
#     manager.
#   • Fall back to printing a manual install link if the asset layout
#     doesn't fit (e.g. Alpine / Arch / NixOS).
#
# Reference: https://openloomi.ai/docs/install/linux

set -euo pipefail

REPO_SLUG="${OPENLOOMI_REPO:-melandlabs/openloomi}"
GITHUB_RELEASE_URL="https://api.github.com/repos/${REPO_SLUG}/releases/latest"
DOCS_BASE="${OPENLOOMI_DOCS_BASE:-https://openloomi.ai}"
INSTALL_ROOT="${OPENLOOMI_INSTALL_ROOT:-/opt/openloomi}"

log() { printf "[openloomi-installer] %s\n" "$*" >&2; }
fail() { log "ERROR: $*"; exit 1; }
require() { command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"; }

require curl
require tar

pick_package() {
  if   command -v apt-get  >/dev/null 2>&1; then echo "deb"
  elif command -v dnf     >/dev/null 2>&1; then echo "rpm"
  elif command -v yum     >/dev/null 2>&1; then echo "rpm"
  elif command -v pacman  >/dev/null 2>&1; then echo "appimage"
  else                                         echo "tarball"
  fi
}

pkg=$(pick_package)
log "Detected package family: ${pkg}"

case "${pkg}" in
  deb|rpm|appimage|tarball)
    asset_name="openloomi-${pkg}.${pkg}"
    [ "${pkg}" = "tarball" ] && asset_name="openloomi-linux-x64.tar.gz"
    [ "${pkg}" = "deb" ]     && asset_name="openloomi-linux-amd64.deb"
    [ "${pkg}" = "rpm" ]     && asset_name="openloomi-linux-x86_64.rpm"
    [ "${pkg}" = "appimage" ] && asset_name="openLoomi-x86_64.AppImage"
    ;;
  *)
    fail "Could not determine package family."
    ;;
esac

asset_url=$(curl -fsSL "${GITHUB_RELEASE_URL}" \
  | sed -n "s/.*\"browser_download_url\":[[:space:]]*\"\\([^\"]*${asset_name}\\)\".*/\\1/p" \
  | head -n1 || true)

if [[ -z "${asset_url}" ]]; then
  log "Could not resolve ${asset_name} from latest release."
  log "Please follow manual instructions at ${DOCS_BASE}/docs/install/linux"
  exit 0
fi

workdir=$(mktemp -d -t openloomi-install.XXXXXX)
trap 'rm -rf "${workdir}"' EXIT
archive="${workdir}/${asset_name}"
log "Downloading ${asset_url}"
curl -fSL --retry 3 --output "${archive}" "${asset_url}" || fail "Download failed."

case "${pkg}" in
  deb)
    require sudo
    sudo dpkg -i "${archive}" || sudo apt-get -f install -y
    ;;
  rpm)
    require sudo
    sudo rpm -Uvh "${archive}"
    ;;
  appimage)
    mkdir -p "${HOME}/.local/bin"
    cp "${archive}" "${HOME}/.local/bin/openloomi"
    chmod +x "${HOME}/.local/bin/openloomi"
    ;;
  tarball)
    mkdir -p "${INSTALL_ROOT}"
    tar -xzf "${archive}" -C "${INSTALL_ROOT}"
    ;;
esac

bin="/opt/openloomi/openloomi"
if [[ ! -x "${bin}" ]]; then
  bin=$(command -v openloomi || true)
fi
if [[ -z "${bin}" || ! -x "${bin}" ]]; then
  # OpenLoomi is installed (e.g. /opt/openloomi/ exists) but the main
  # binary hasn't been placed yet — the desktop app's first launch does
  # this. Exit 0 with a friendly note so the bridge can guide the user,
  # instead of failing and making them think the install broke.
  log "OpenLoomi files installed, but the main binary is not on PATH yet."
  log "Launch the OpenLoomi desktop app once so it places the main binary,"
  log "then re-run /openloomi:setup from Claude Code to finish setup."
  exit 0
fi

log "Verifying the OpenLoomi install…"
log "  found main binary at: ${bin}"
log "  (version is reported by the desktop app on first launch — calling --version on the Tauri main binary would flash a GUI window)"

log "Install complete. Re-run /openloomi:setup to continue."
