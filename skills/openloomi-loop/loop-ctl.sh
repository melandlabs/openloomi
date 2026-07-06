#!/usr/bin/env bash
# loop-ctl.sh — controls the Loop subsystem inside the main OpenLoomi app.
#
# Usage: ./loop-ctl.sh {start|stop|status|restart|tick|brief|wrap|inbox}
#
# As of 2026-07-06 the Loop runs inside the main app's Node.js runtime
# (started from apps/web/instrumentation.ts). There is no separate
# `loop-daemon` or `loop-web` process anymore — start/stop here are
# convenience wrappers that just invoke the Loop CLI.

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"

# Locate the Loop CLI shim by walking up from this file.
find_cli() {
  local candidates=(
    "$SKILL_DIR/../../apps/web/scripts/loop-cli.mjs"
    "$SKILL_DIR/../../../apps/web/scripts/loop-cli.mjs"
    "$PWD/apps/web/scripts/loop-cli.mjs"
  )
  for p in "${candidates[@]}"; do
    if [ -f "$p" ]; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

CLI="$(find_cli || true)"
if [ -z "$CLI" ]; then
  echo "✗ cannot find apps/web/scripts/loop-cli.mjs — run from the monorepo" >&2
  exit 1
fi

run_loop() {
  node "$CLI" "$@"
}

case "${1:-}" in
  start)
    echo "✓ Loop runs inside the main OpenLoomi app (started by instrumentation.ts)."
    echo "  Ensure the main app is running, then check: $0 status"
    ;;
  stop)
    echo "✓ Loop scheduler stops with the main app. To pause: $0 disable"
    run_loop config set enabled=false
    echo "✓ Loop disabled (will not tick or schedule)."
    ;;
  enable)
    run_loop config set enabled=true
    echo "✓ Loop enabled."
    ;;
  disable)
    run_loop config set enabled=false
    echo "✓ Loop disabled."
    ;;
  restart)
    run_loop config set enabled=false
    run_loop config set enabled=true
    echo "✓ Loop restarted."
    ;;
  status)
    run_loop status
    ;;
  tick)
    shift; run_loop tick "$@"
    ;;
  brief)
    shift; run_loop brief "$@"
    ;;
  wrap)
    shift; run_loop wrap "$@"
    ;;
  inbox)
    shift; run_loop inbox "$@"
    ;;
  run)
    shift; run_loop run "$@"
    ;;
  dismiss)
    shift; run_loop dismiss "$@"
    ;;
  doctor)
    run_loop doctor
    ;;
  *)
    cat <<EOF
Usage: $0 {start|stop|status|restart|tick|brief|wrap|inbox|run|dismiss|doctor|enable|disable}

Convenience wrappers around apps/web/scripts/loop-cli.mjs.

Examples:
  $0 tick
  $0 inbox --status=pending
  $0 run dec_xxx --dry
  $0 dismiss dec_xxx "spam"
  $0 status
  $0 doctor
EOF
    exit 1
    ;;
esac