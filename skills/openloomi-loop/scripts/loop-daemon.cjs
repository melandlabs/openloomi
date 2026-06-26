#!/usr/bin/env node
/**
 * openloomi-loop daemon (legacy / lib-only mode)
 *
 * In the **agentic** mode (default), Claude itself pulls signals via
 * Composio MCP and writes them to data/signals.jsonl. There is no
 * background process. The tick is invoked by:
 *
 *   claude -p "$(node $SKILL_DIR/scripts/loop-tick.cjs)"
 *
 * This file is kept for two reasons:
 *   1. `tick()` exposes the same analyze pipeline (inbox → classify →
 *      decision emit) as a reusable function that the CLI's `analyze`
 *      command and any Claude session can call.
 *   2. Some setups still want a thin `npm`-style loop. In that case,
 *      run `loop-daemon.cjs` with `--once` from a `cron` / launchd job
 *      AFTER Claude has populated data/signals.jsonl.
 *
 * IMPORTANT: This script does NOT fetch from Composio and does NOT
 * maintain its own memory. Memory is delegated to `openloomi-memory`.
 * Signal ingestion is handled either by:
 *   - Claude agentically via mcp__composio__* (preferred)
 *   - Manual drop into data/inbox/*.json (still supported)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const lib = require('./loop-lib.cjs');

const { paths, signals, decisions, config, utils, rules } = lib;

// ---------------------------------------------------------------------------
// Inbox drop folder (always-on manual ingestion path)
// ---------------------------------------------------------------------------

function pullFromInboxDir(cfg) {
  if (!cfg.enableSources.file) return 0;
  const inbox = path.join(paths.DATA_DIR, 'inbox');
  fs.mkdirSync(path.join(inbox, '.processed'), { recursive: true });
  fs.mkdirSync(path.join(inbox, '.failed'), { recursive: true });
  const files = fs.readdirSync(inbox).filter((f) => f.endsWith('.json'));
  let added = 0;
  for (const f of files) {
    const fp = path.join(inbox, f);
    try {
      const payload = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const sig = signals.append(
        payload.source || 'manual',
        payload.type || 'email',
        payload.payload || payload,
        { origin: `inbox:${f}` }
      );
      fs.renameSync(fp, path.join(inbox, '.processed', f));
      added++;
      utils.log(`inbox: ingested ${f} → ${sig.id}`);
    } catch (e) {
      utils.log(`inbox: bad file ${f}: ${e.message}`);
      fs.renameSync(fp, path.join(inbox, '.failed', f));
    }
  }
  return added;
}

// ---------------------------------------------------------------------------
// Decision generation
// ---------------------------------------------------------------------------

function generateDecisions(recentSignals, cfg) {
  const existingPendingSignals = new Set(decisions.pending().map((d) => d.signal_id));

  let created = 0;
  let skipped = 0;
  for (const sig of recentSignals) {
    if (existingPendingSignals.has(sig.id)) continue;

    const reason = rules.isHardSkipped(sig, cfg);
    if (reason) { skipped++; utils.log(`skip ${sig.id}: ${reason}`); continue; }

    const cand = rules.classify(sig);
    if (!cand) continue;

    const fromEmail = (sig.payload.from || '').match(/<([^>]+)>/)?.[1] || sig.payload.from;
    const why = [`Source: ${sig.source}:${sig.type}`];
    if (sig.payload.subject) why.push(`Subject: ${sig.payload.subject}`);

    decisions.add({
      signal_id: sig.id,
      type: cand.type,
      title: cand.title,
      action: cand.action,
      context: {
        why,
        // Note: in agentic mode, Claude populates memory_refs via openloomi-memory.
        // The lib-level tick (used by `loop analyze`) leaves it empty — Claude can
        // re-enrich at execution time.
        memory_refs: [],
        person: null,
      },
      // Without an openloomi-memory lookup at lib-level, default to 0.60.
      // The agent tick raises this to 0.85 when the sender is known in memory.
      confidence: 0.6,
      source_signal: sig,
    });
    created++;
  }
  return { created, skipped };
}

// ---------------------------------------------------------------------------
// One tick (no fetching — assumes signals are already on disk)
// ---------------------------------------------------------------------------

function tick() {
  const cfg = config.read();

  const addedFromInbox = pullFromInboxDir(cfg);

  const recent = signals.list({ limit: Math.min(cfg.maxSignals, 200) });
  const { created, skipped } = generateDecisions(recent, cfg);

  signals.trim(cfg.maxSignals);

  const status = {
    ts: utils.now(),
    pid: process.pid,
    cfg,
    mode: 'agentic',
    sources: {
      composio: '(via Claude MCP — run loop-tick)',
      inbox: addedFromInbox,
    },
    counts: {
      signals: signals.list({ limit: cfg.maxSignals }).length,
      pending: decisions.pending().length,
      done: decisions.list('done').length,
      dismissed: decisions.list('dismissed').length,
    },
    last_tick: { touched: 0, created, skipped },
  };
  utils.writeJsonAtomic(paths.STATUS_PATH, status);
  return status;
}

// ---------------------------------------------------------------------------
// Main loop (legacy — for cron / launchd schedulers that want a real process)
// ---------------------------------------------------------------------------

function main() {
  paths.ensureDirs();
  const cfg = config.read();
  const once = process.argv.includes('--once');
  const intervalMs = cfg.intervalSec * 1000;

  fs.writeFileSync(paths.PID_PATH, String(process.pid));
  utils.log(`daemon start pid=${process.pid} interval=${cfg.intervalSec}s (agentic fetch via Claude MCP)`);

  const cleanup = () => {
    try { fs.unlinkSync(paths.PID_PATH); } catch {}
    utils.log(`daemon stop pid=${process.pid}`);
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  let timer;
  const schedule = () => {
    try {
      const s = tick();
      utils.log(`tick: pending=${s.counts.pending} created=${s.last_tick.created} skipped=${s.last_tick.skipped}`);
    } catch (e) {
      utils.log(`tick error: ${e.message}`);
    }
    if (once) return cleanup();
    timer = setTimeout(schedule, intervalMs);
  };
  schedule();
}

if (require.main === module) {
  main();
}

module.exports = { tick, main };
