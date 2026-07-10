#!/usr/bin/env node
/**
 * Loop CLI — thin command-line surface for the Loop module. Implemented as
 * a single file so `apps/web/scripts/loop-cli.mjs` can spawn it without
 * bringing tsx into the skill shim's path.
 *
 * Usage:
 *   tsx apps/web/lib/loop/cli.ts <command> [args]
 *
 * Commands:
 *   tick [--userId <id>]       run one tick (signals → classify → enqueue)
 *   analyze                    alias for `tick`
 *   inbox [--status=X]         list decisions (default: all)
 *   run <id> [--dry]           invoke agent on a decision
 *   dismiss <id> [reason]      move decision → dismissed
 *   promote <id>               dismissed → pending
 *   status                     aggregated loop state
 *   brief [--force]            build morning brief + enqueue card
 *   wrap [--force]             build evening wrap + enqueue card
 *   inject <signal.json>       append a signal from stdin / file
 *   config [show|set key=val]  read/write preferences
 *   doctor                     quick health check (paths + preferences)
 *
 * Exit codes:
 *   0 success
 *   1 generic failure
 *   2 not found
 *   3 invalid input
 */

import { readFileSync, existsSync } from "node:fs";

// CLI loads ONLY server-safe submodules eagerly. The barrel "./index"
// re-exports the (server-only) cron scheduler, which transitively pulls
// `server-only`-marked modules and breaks tsx. We import directly from
// the per-command submodules so the CLI stays usable.
import {
  applyDecisionAction,
  state,
  triggerBrief,
  triggerWrap,
  listDecisions,
  getPreferences,
} from "./server";
import { run as runTick, setActiveUser } from "./tick";
import { decisions, signals } from "./store";
import { readPreferences, writePreferences } from "./preferences";
import type { DecisionStatus } from "./types";

interface ParsedArgs {
  _: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          out.flags[key] = next;
          i++;
        } else {
          out.flags[key] = true;
        }
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function usage(): string {
  return `Usage: loop <command> [args]

Commands:
  tick [--userId <id>]       run one tick (default: agentic)
  analyze                    alias for tick
  inbox [--status=X]         list decisions (default: all)
  run <id> [--dry]           invoke agent on a decision
  dismiss <id> [reason]      dismiss a decision
  promote <id>               dismissed → pending
  status                     aggregated state
  brief [--force]            build morning brief + enqueue card
  wrap [--force]             build evening wrap + enqueue card
  inject <file|->            append a signal (JSON file or stdin for -)
  ingest-decision <file|->   persist an agent-built decision (agentic tick only)
  config [show|set k=v]      read/write preferences
  doctor                     health check
`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    process.stdout.write(usage());
    return 0;
  }
  try {
    switch (cmd) {
      case "tick":
      case "analyze": {
        // Optional `--userId <id>` — pass-through so the CLI can enrich
        // against the same user the web route would. Without it we run
        // un-enriched (base confidence only). The tick itself is always
        // agentic — dispatches the full pipeline prompt to /api/native/agent.
        const userId =
          typeof args.flags.userId === "string" ? args.flags.userId : undefined;
        if (userId) setActiveUser(userId);
        const out = await runTick({ userId });
        process.stdout.write(JSON.stringify(out, null, 2));
        return 0;
      }
      case "inbox": {
        const status = args.flags.status as DecisionStatus | undefined;
        const items = listDecisions(status);
        process.stdout.write(
          JSON.stringify({ count: items.length, items }, null, 2),
        );
        return 0;
      }
      case "run": {
        const id = args._[1];
        if (!id) {
          process.stderr.write("run: id required\n");
          return 3;
        }
        const dry = !!args.flags.dry;
        const action: "run" | "dry" = dry ? "dry" : "run";
        const out = await applyDecisionAction(id, { action });
        process.stdout.write(JSON.stringify(out, null, 2));
        return out.ok ? 0 : 1;
      }
      case "dismiss": {
        const id = args._[1];
        if (!id) {
          process.stderr.write("dismiss: id required\n");
          return 3;
        }
        const reason = args._[2];
        const out = await applyDecisionAction(id, {
          action: "dismiss",
          ...(reason ? { reason } : {}),
        });
        process.stdout.write(JSON.stringify(out, null, 2));
        return out.ok ? 0 : 2;
      }
      case "promote": {
        const id = args._[1];
        if (!id) {
          process.stderr.write("promote: id required\n");
          return 3;
        }
        const out = await applyDecisionAction(id, { action: "promote" });
        process.stdout.write(JSON.stringify(out, null, 2));
        return out.ok ? 0 : 2;
      }
      case "status": {
        const out = await state();
        process.stdout.write(JSON.stringify(out, null, 2));
        return 0;
      }
      case "brief": {
        const force = !!args.flags.force;
        const out = await triggerBrief({ force });
        process.stdout.write(JSON.stringify(out, null, 2));
        return out.ok ? 0 : 1;
      }
      case "wrap": {
        const force = !!args.flags.force;
        const out = await triggerWrap({ force });
        process.stdout.write(JSON.stringify(out, null, 2));
        return out.ok ? 0 : 1;
      }
      case "inject": {
        const file = args._[1] || "-";
        const raw =
          file === "-"
            ? readStdin()
            : existsSync(file)
              ? readFileSync(file, "utf8")
              : null;
        if (raw === null) {
          process.stderr.write(`inject: ${file} not found\n`);
          return 3;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          process.stderr.write("inject: invalid json\n");
          return 3;
        }
        const p = parsed as {
          source?: string;
          type?: string;
          payload?: Record<string, unknown>;
        };
        const sig = signals.append(
          p.source ?? "manual",
          (p.type ?? "email") as never,
          p.payload ?? {},
        );
        process.stdout.write(JSON.stringify({ ok: true, id: sig.id }, null, 2));
        return 0;
      }
      case "ingest-decision": {
        // Persist a decision that the agent built. Used by the agentic tick
        // (tick-prompt.ts §5) — the agent runs the full pipeline then POSTs
        // each typed decision here. Decisions go through `decisions.add()`,
        // which normalizes memory_refs/insight_refs placement and writes
        // atomically.
        const file = args._[1] || "-";
        const raw =
          file === "-"
            ? readStdin()
            : existsSync(file)
              ? readFileSync(file, "utf8")
              : null;
        if (raw === null) {
          process.stderr.write(`ingest-decision: ${file} not found\n`);
          return 3;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          process.stderr.write("ingest-decision: invalid json\n");
          return 3;
        }
        const p = parsed as Record<string, unknown>;
        if (!p.type || !p.title || !p.action) {
          process.stderr.write(
            "ingest-decision: required fields missing (type, title, action)\n",
          );
          return 3;
        }
        try {
          const dec = decisions.add(
            p as unknown as Parameters<typeof decisions.add>[0],
          );
          if (dec === null) {
            process.stdout.write(
              JSON.stringify(
                {
                  ok: true,
                  decision: null,
                  filtered: "noop_or_tick_summary",
                },
                null,
                2,
              ),
            );
            return 0;
          }
          process.stdout.write(
            JSON.stringify({ ok: true, decision: dec }, null, 2),
          );
          return 0;
        } catch (e) {
          process.stderr.write(
            `ingest-decision: failed to persist: ${(e as Error).message}\n`,
          );
          return 1;
        }
      }
      case "config": {
        const sub = args._[1] || "show";
        if (sub === "show") {
          process.stdout.write(JSON.stringify(readPreferences(), null, 2));
          return 0;
        }
        if (sub === "set") {
          const kv = args._[2];
          if (!kv || !kv.includes("=")) {
            process.stderr.write("config set: key=value required\n");
            return 3;
          }
          const [k, v] = kv.split("=", 2);
          const patch: Record<string, unknown> = {};
          const current = readPreferences() as unknown as Record<
            string,
            unknown
          >;
          if (typeof current[k] === "number") {
            const n = Number(v);
            if (Number.isNaN(n)) {
              process.stderr.write(`config set: ${k} is not a number\n`);
              return 3;
            }
            patch[k] = n;
          } else if (typeof current[k] === "boolean") {
            patch[k] = v === "true" || v === "1";
          } else {
            patch[k] = v;
          }
          const next = writePreferences(patch);
          process.stdout.write(JSON.stringify(next, null, 2));
          return 0;
        }
        process.stderr.write(`config: unknown subcommand ${sub}\n`);
        return 3;
      }
      case "doctor": {
        const out = await state();
        process.stdout.write(
          JSON.stringify(
            {
              enabled: out.enabled,
              preferences: out.preferences,
              counts: out.counts,
              lastTickAt: out.lastTickAt,
              connectors: out.connectors.length,
            },
            null,
            2,
          ),
        );
        return 0;
      }
      default:
        process.stderr.write(`loop: unknown command ${cmd}\n${usage()}`);
        return 3;
    }
  } catch (e) {
    process.stderr.write(
      `loop: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  }
}

function readStdin(): string {
  try {
    // Read synchronously from stdin
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      `loop: fatal ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(1);
  });

// Avoid unused-import warnings
void decisions;
void getPreferences;
