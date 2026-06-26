#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync, execSync } = require('node:child_process');
const lib = require('./loop-lib.cjs');
const daemon = require('./loop-daemon.cjs');

const { paths, api, signals, decisions, rules, config, utils } = lib;

// Always ensure runtime dirs exist on script load — so a fresh install
// works regardless of how the script is invoked (foreground, nohup redirect,
// piped, etc.). Subcommands also call this for safety, but doing it here
// means shell redirects like `node script.js > data/daemon.log` succeed.
paths.ensureDirs();

// ---------------------------------------------------------------------------
// Tiny arg parser (no deps)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) args.flags[a.slice(2, eq)] = a.slice(eq + 1);
      else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) { args.flags[key] = next; i++; }
        else args.flags[key] = true;
      }
    } else args._.push(a);
  }
  return args;
}

function usage() {
  console.log(`openloomi-loop — agentic context → decision → execute pipeline

Signal fetching is done by Claude via Composio MCP (mcp__composio__*).
This skill provides the playbook, data store, and execution CLI.

Usage: openloomi-loop <command> [options]

Commands:
  tick [--compact]                Print the prompt Claude runs for one Loop tick
  schedule [--interval N]         Loop: run \`claude -p $(loop tick --compact)\` every Ns + watch
  watch [--interval N]            Poll decisions.json and fire macOS notifications on new pending
  notify [--all] [--webhook URL]  Manually fire notifications (--all = all pending; default = new only)
  ingest-decision <json|->        Append a decision (called by the Claude tick agent)
  status                          Show last-tick snapshot + counts
  inbox [--pick] [--limit N]      List pending decisions (--pick: arrow-key picker)
  analyze                         Lib-level tick: inbox -> memory -> classify -> decisions
  inject <file.json|->            Drop a signal into data/inbox/
  decisions [--status pending|done|dismissed|all]
  decision <id>                   Show one decision
  run <id> [--dry]                Execute decision -> spawn claude code
  dismiss <id>                    Mark as dismissed
  memory <subcommand> [args...]    Delegate to openloomi-memory CLI (search-all, search-memory, list-insights, add-memory, ...)
  config [get|set k v]            Read/edit config
  logs [-n N]                     Tail the loop log
  serve                           REPL: list / run / dismiss / status / quit

Data dir: ${paths.DATA_DIR}
`);
}

// ---------------------------------------------------------------------------
// Tick prompt + scheduler (agentic mode)
// ---------------------------------------------------------------------------

function cmdTick(args) {
  // Delegate to loop-tick.cjs which prints the prompt
  const tickArgs = [];
  if (args.flags.compact) tickArgs.push('--compact');
  if (args.flags.json) tickArgs.push('--json');
  for (const [k, v] of Object.entries(args.flags)) {
    if (k === 'compact' || k === 'json') continue;
    tickArgs.push(`--config=${k}=${v}`);
  }
  const r = spawnSync(process.execPath, [path.join(__dirname, 'loop-tick.cjs'), ...tickArgs], {
    encoding: 'utf8',
  });
  process.stdout.write(r.stdout);
  if (r.status !== 0) process.stderr.write(r.stderr);
}

// ---------------------------------------------------------------------------
// Notify + Watch (continuous signal collection with desktop notifications)
// ---------------------------------------------------------------------------

const NOTIFY_LOG_PATH = path.join(paths.DATA_DIR, 'notifications.log');
const SESSION_PATH = path.join(paths.DATA_DIR, 'watch.session.json');

// Session tracking — every watch/schedule start writes {pid, started_at, host}
// so we can bucket log entries and answer "what happened in THIS session".
function currentSession() {
  try { return JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8')); } catch { return null; }
}
function writeSession() {
  const s = { pid: process.pid, started_at: new Date().toISOString(), host: os.hostname() };
  try { fs.writeFileSync(SESSION_PATH, JSON.stringify(s, null, 2)); } catch {}
  return s;
}
function sessionTag() {
  const s = currentSession();
  if (!s) return '';
  return `[pid=${s.pid} started=${s.started_at}] `;
}

function notifyDesktop(title, subtitle, body, sound = 'default') {
  // macOS native notification via osascript (no extra deps).
  // Silent no-op on other platforms.
  if (process.platform !== 'darwin') return false;
  const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)} subtitle ${JSON.stringify(subtitle)} sound name ${JSON.stringify(sound)}`;
  try {
    const r = spawnSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 3000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

function notifyWebHook(url, payload) {
  // Generic webhook (Slack-compatible JSON). Used by `loop notify --webhook=...`
  if (!url) return false;
  try {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const req = require('node:http').request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, () => {});
    req.on('error', () => {});
    req.write(body);
    req.end();
    return true;
  } catch { return false; }
}

function logNotification(line) {
  try { fs.appendFileSync(NOTIFY_LOG_PATH, `[${new Date().toISOString()}] ${sessionTag()}${line}\n`); } catch {}
}

function notifyForDecisions(newOnes, opts = {}) {
  if (!newOnes.length) return;
  const title = 'openloomi-loop';
  const subtitle = `${newOnes.length} new decision${newOnes.length > 1 ? 's' : ''}`;
  // Compact body for desktop: title + 1-line trigger context each
  const body = newOnes.slice(0, 4).map((d) => {
    const p = d.source_signal?.payload || {};
    let ctx = '';
    if (d.source_signal?.type === 'calendar_event') {
      const start = fmtTimeShort(p.start);
      const org = extractName(p.organizer) || '?';
      ctx = ` — ${start}, ${org}`;
    } else if (d.source_signal?.type === 'email') {
      ctx = ` — from ${extractName(p.from) || '?'}`;
    }
    return `• ${d.title}${ctx}`;
  }).join('\n') + (newOnes.length > 4 ? `\n…and ${newOnes.length - 4} more` : '');

  // Always log (rich form)
  logNotification(`${subtitle}\n${newOnes.map((d) => fmtDecision(d)).join('\n\n')}`);

  // Desktop
  if (opts.desktop !== false) notifyDesktop(title, subtitle, body);

  // Webhook (Slack-compatible)
  const webhook = process.env.LOOP_NOTIFY_WEBHOOK || opts.webhook;
  if (webhook) {
    notifyWebHook(webhook, {
      text: `${title}: ${subtitle}\n${body}`,
      attachments: newOnes.slice(0, 10).map((d) => {
        const p = d.source_signal?.payload || {};
        const fields = [
          { title: 'type', value: d.type, short: true },
          { title: 'confidence', value: String(d.confidence ?? '?'), short: true },
        ];
        if (d.source_signal?.type === 'calendar_event') {
          fields.push({ title: 'when', value: `${p.start || '?'} → ${p.end || '?'}`, short: true });
          fields.push({ title: 'organizer', value: p.organizer || '?', short: true });
        } else if (d.source_signal?.type === 'email') {
          fields.push({ title: 'from', value: p.from || '?', short: true });
          fields.push({ title: 'subject', value: (p.subject || '').slice(0, 80), short: false });
        }
        if (d.context?.memory_refs?.length) {
          fields.push({ title: 'memory refs', value: d.context.memory_refs.join(', '), short: false });
        }
        return {
          title: d.title,
          text: (d.context?.why || []).join(' | '),
          color: d.confidence >= 0.8 ? 'good' : 'warning',
          fields,
        };
      }),
    });
  }

  // Stdout (for `loop watch` foreground)
  console.log(`\n🔔 ${subtitle}`);
  for (const d of newOnes) console.log(`  • [${d.type}] ${d.title}  (conf=${(d.confidence || 0).toFixed(2)})`);
  console.log("\n  Run: \`openloomi-loop inbox --pick\` to pick one\n");
}

function diffNewDecisions(prevIds, currentPending) {
  const seen = new Set(prevIds);
  return currentPending.filter((d) => !seen.has(d.id));
}

function loadSeenIds() {
  const f = path.join(paths.DATA_DIR, 'notifications.seen.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
}
function saveSeenIds(ids) {
  const f = path.join(paths.DATA_DIR, 'notifications.seen.json');
  try { fs.writeFileSync(f, JSON.stringify(ids.slice(-2000), null, 2)); } catch {}
}

function cmdNotify(args) {
  // Manual notification: `loop notify [--desktop] [--webhook URL] [--all]`
  // --all: notify about ALL current pending (ignores seen)
  // default: notify about new (not seen) pending
  const all = !!args.flags.all;
  const desktop = args.flags.desktop !== false;
  const webhook = args.flags.webhook || process.env.LOOP_NOTIFY_WEBHOOK;

  const pending = decisions.pending();
  let toNotify;
  if (all) {
    toNotify = pending;
  } else {
    const seen = new Set(loadSeenIds());
    toNotify = pending.filter((d) => !seen.has(d.id));
    saveSeenIds(pending.map((d) => d.id));
  }

  if (!toNotify.length) {
    console.log(`(no ${all ? '' : 'new '}pending decisions to notify about)`);
    return;
  }

  notifyForDecisions(toNotify, { desktop, webhook });
  console.log(`notified about ${toNotify.length} decision(s). log: ${NOTIFY_LOG_PATH}`);
}

async function cmdWatch(args) {
  // Long-running watcher: poll decisions.json, fire notifications on new pending.
  // Does NOT run ticks — pair with `loop schedule` (or external cron) to feed it.
  const pollMs = Number.parseInt(args.flags.interval || '5', 10) * 1000;
  const session = writeSession();
  console.log(`Watching ${paths.DATA_DIR}/decisions.json (poll every ${pollMs / 1000}s)`);
  console.log(`Session:  pid=${session.pid} started=${session.started_at}`);
  console.log(`Notifications: macOS desktop${process.env.LOOP_NOTIFY_WEBHOOK ? ' + webhook' : ''}`);
  console.log("Press Ctrl+C to stop.\n");
  utils.log(`[watch] session started pid=${session.pid} poll=${pollMs/1000}s`);

  const seen = new Set(loadSeenIds());
  // Seed seen with currently pending so we don't fire notifications for old items.
  for (const d of decisions.pending()) seen.add(d.id);
  saveSeenIds([...seen]);

  const cleanup = () => {
    console.log('\n[watch] stopped');
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const tick = () => {
    try {
      const pending = decisions.pending();
      const fresh = pending.filter((d) => !seen.has(d.id));
      if (fresh.length) {
        notifyForDecisions(fresh, { desktop: true });
        for (const d of fresh) seen.add(d.id);
        saveSeenIds([...seen]);
      }
    } catch (e) {
      utils.log(`[watch] error: ${e.message}`);
    }
    setTimeout(tick, pollMs);
  };
  tick();
}

function cmdSchedule(args) {
  const interval = Number.parseInt(args.flags.interval || config.read().intervalSec, 10);
  const claudeBin = process.env.LOOP_CLAUDE_BIN || 'claude';
  const alsoWatch = args.flags.watch !== false; // default: also watch for notifications

  const session = writeSession();
  console.log(`Scheduling Loop ticks every ${interval}s via "${claudeBin} -p"`);
  console.log(`Session:  pid=${session.pid} started=${session.started_at}`);
  if (alsoWatch) console.log("Also watching for new decisions (desktop notifications enabled).");
  console.log("Press Ctrl+C to stop.\n");
  utils.log(`[schedule] session started pid=${session.pid} interval=${interval}s`);

  paths.ensureDirs();
  fs.writeFileSync(paths.PID_PATH, String(process.pid));
  const cleanup = () => {
    try { fs.unlinkSync(paths.PID_PATH); } catch {}
    console.log('\n[schedule] stopped');
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  let running = false;
  const seen = new Set(loadSeenIds());
  for (const d of decisions.pending()) seen.add(d.id);
  saveSeenIds([...seen]);

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const prompt = spawnSync(process.execPath, [path.join(__dirname, 'loop-tick.cjs'), '--compact'], { encoding: 'utf8' }).stdout;
      utils.log("[schedule] spawning claude");
      const child = spawn(claudeBin, ['-p', prompt, '--output-format', 'text'], {
        stdio: 'inherit',
        env: process.env,
      });
      await new Promise((resolve) => child.on('exit', (code) => {
        utils.log(`[schedule] claude exited ${code}`);
        resolve();
      }));
    } catch (e) {
      utils.log(`[schedule] error: ${e.message}`);
    }
    running = false;

    // After each tick, check for new pending decisions and notify.
    if (alsoWatch) {
      try {
        const pending = decisions.pending();
        const fresh = pending.filter((d) => !seen.has(d.id));
        if (fresh.length) {
          notifyForDecisions(fresh, { desktop: true });
          for (const d of fresh) seen.add(d.id);
          saveSeenIds([...seen]);
        }
      } catch (e) {
        utils.log(`[schedule.notify] error: ${e.message}`);
      }
    }

    setTimeout(tick, interval * 1000);
  };
  tick();
}

function cmdIngestDecision(args) {
  // Used by the Claude tick agent to append a decision without writing JSON directly
  const target = args._[1];
  let raw;
  if (!target || target === '-') {
    raw = fs.readFileSync(0, 'utf8');
  } else if (fs.existsSync(target)) {
    raw = fs.readFileSync(target, 'utf8');
  } else {
    raw = target; // raw JSON passed as arg
  }
  let obj;
  try { obj = JSON.parse(raw); }
  catch (e) { console.error(`bad json: ${e.message}`); process.exit(1); }
  // Normalize required fields
  obj.id = obj.id || `dec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  obj.ts = obj.ts || utils.now();
  obj.status = obj.status || 'pending';
  decisions.add(obj);
  console.log(JSON.stringify({ ok: true, id: obj.id }));
}

function cmdStatus() {
  const cfg = config.read();
  const status = utils.readJson(paths.STATUS_PATH, null);
  console.log("mode:    agentic (Claude pulls signals via Composio MCP)");
  console.log(`data:    ${paths.DATA_DIR}`);
  console.log(`config:  interval=${cfg.intervalSec}s sources=${Object.entries(cfg.enableSources).filter(([, v]) => v).map(([k]) => k).join(',')}`);
  if (status) {
    console.log(`tick:    ${status.ts}`);
    console.log("counts:");
    for (const [k, v] of Object.entries(status.counts)) console.log(`  ${k.padEnd(18)} ${v}`);
    if (status.last_tick) {
      console.log(`last:    touched=${status.last_tick.touched} created=${status.last_tick.created} skipped=${status.last_tick.skipped}`);
    }
  } else {
    console.log("counts:  (no tick yet — run \`loop analyze\` or have Claude run \`loop tick\`)");
  }
  const sess = currentSession();
  if (sess) {
    console.log(`session: pid=${sess.pid} started=${sess.started_at}` + (sess.host ? ' host=' + sess.host : ''));
  }
}

// Parse notifications.log entries into {ts, sessionPid, sessionStarted, count, body}.
// Robust to old (pre-session) lines that have no session tag.
function parseNotifyLog(sinceIso) {
  if (!fs.existsSync(NOTIFY_LOG_PATH)) return [];
  const since = sinceIso ? new Date(sinceIso).getTime() : null;
  const lines = fs.readFileSync(NOTIFY_LOG_PATH, 'utf8').split('\n');
  const entries = [];
  let cur = null;
  for (const raw of lines) {
    if (!raw) continue;
    // Header: [ISO] [pid=X started=Y] N new decision(s)
    const m = raw.match(/^\[([0-9TZ:.\-]+)\] (?:\[pid=(\d+) started=([0-9TZ:.\-]+)\] )?(\d+) new decision/);
    if (m) {
      if (cur) entries.push(cur);
      cur = {
        ts: m[1],
        tsMs: new Date(m[1]).getTime(),
        sessionPid: m[2] ? Number(m[2]) : null,
        sessionStarted: m[3] || null,
        count: Number(m[4]),
        body: [],
      };
      continue;
    }
    if (cur) cur.body.push(raw);
  }
  if (cur) entries.push(cur);
  return since ? entries.filter((e) => e.tsMs >= since) : entries;
}

function cmdSummary(args) {
  // Report what the CURRENT watch session actually did.
  //   no flag         → window = current session's started_at
  //   --since=<ISO>   → window = that timestamp onward
  //   no session file → window = entire log (with warning)
  const sess = currentSession();
  const since = args.flags.since || null;
  let mode;
  if (since) {
    mode = `since=${since}`;
  } else if (sess) {
    mode = `current session (pid=${sess.pid} started=${sess.started_at})`;
  } else {
    mode = 'entire log (no session file — run `loop watch` to start one)';
  }
  const entries = since ? parseNotifyLog(since) : (sess ? parseNotifyLog(sess.started_at) : parseNotifyLog());
  console.log(`scope:   ${mode}`);
  console.log(`batches: ${entries.length}`);
  console.log(`notified: ${entries.reduce((n, e) => n + e.count, 0)} decisions`);
  if (!entries.length) { console.log('(no notifications in this window)'); return; }
  // Tally decision types from body lines that begin with a type keyword
  const typeCounts = {};
  for (const e of entries) {
    for (const line of e.body) {
      const tm = line.match(/^\s*(rsvp|draft_reply|review_pr|slack_reply|todo)\s+/);
      if (tm) typeCounts[tm[1]] = (typeCounts[tm[1]] || 0) + 1;
    }
  }
  if (Object.keys(typeCounts).length) {
    console.log('types:');
    for (const [k, v] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(14)} ${v}`);
    }
  }
  console.log('\nbatches:');
  for (const e of entries) {
    const all = e.body.filter((l) => /^\s*(rsvp|draft_reply|review_pr|slack_reply|todo)\s+/.test(l));
    console.log(`  ${e.ts}  [pid=${e.sessionPid ?? '?'}]  ${e.count} new`);
    for (const fl of all.slice(0, 4)) console.log(`    ${fl.trim()}`);
    if (all.length > 4) console.log(`    …and ${e.count - 4} more`);
  }
}

// ---------------------------------------------------------------------------
// Inbox + decisions listing
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Inbox + decisions listing
// ---------------------------------------------------------------------------

function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diffMs = t - Date.now();
  const absMin = Math.abs(diffMs) / 60000;
  let label;
  if (absMin < 60) label = `${Math.round(absMin)}m`;
  else if (absMin < 60 * 24) label = `${Math.round(absMin / 60)}h`;
  else label = `${Math.round(absMin / (60 * 24))}d`;
  return diffMs >= 0 ? `in ${label}` : `${label} ago`;
}

function fmtTimeShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const dayMo = `${d.getMonth() + 1}/${d.getDate()}`;
  return `${dayMo} ${hh}:${mm}`;
}

function extractEmail(s) {
  if (!s) return null;
  // Tolerate object shapes from Google Calendar / GitHub:
  //   { email, displayName } or { emailAddress } or string "Name <e@x>" or "e@x"
  if (typeof s === 'object') {
    return (s.email || s.emailAddress || '').toString().toLowerCase().trim() || null;
  }
  const m = String(s).match(/<([^>]+)>/);
  return (m ? m[1] : String(s)).toLowerCase().trim();
}

function extractName(s) {
  if (!s) return '';
  if (typeof s === 'object') {
    return (s.displayName || s.name || s.email || s.emailAddress || '').toString().trim();
  }
  const m = String(s).match(/^(.+?)\s*<[^>]+>$/);
  return m ? m[1].trim() : String(s);
}

function fmtDecision(d, idx = null) {
  const head = idx != null ? `[${idx + 1}] ` : '';
  const conf = d.confidence ? ` conf=${d.confidence.toFixed(2)}` : '';
  const lines = [];
  // Header
  lines.push(`${head}${d.id}  ${d.type.padEnd(12)} ${d.title}${conf}`);
  // Triggering context (synthesized from source_signal.payload + context)
  const sig = d.source_signal || {};
  const payload = sig.payload || {};
  const ctx = d.context || {};
  const ind = '      ';

  // Trigger line — varies by signal type
  if (sig.type === 'calendar_event') {
    const start = payload.start || '';
    const end = payload.end || '';
    const organizer = extractName(payload.organizer) || '?';
    const orgEmail = extractEmail(payload.organizer) || '';
    const attendees = Array.isArray(payload.attendees) ? payload.attendees : [];
    const me = orgEmail ? "you" : '';
    const triggers = [];
    if (start) {
      const startShort = fmtTimeShort(start);
      const endShort = fmtTimeShort(end);
      triggers.push(`${startShort}${endShort ? `–${endShort}` : ''} ${relTime(start)}`);
    }
    triggers.push(`organizer: ${organizer}${orgEmail ? ` <${orgEmail}>` : ''}`);
    if (attendees.length) {
      const needsAction = attendees.filter((a) => {
        const resp = (typeof a === 'object' ? a.responseStatus : null) || '';
        return resp === 'needsAction';
      }).length;
      triggers.push(`${attendees.length} attendees${needsAction ? ` (${needsAction} pending)` : ''}`);
    }
    if (payload.my_response) {
      triggers.push(`your RSVP: ${payload.my_response}`);
    }
    if (payload.attachmentUrl || payload.hasAttachment) {
      triggers.push("📎 has agenda doc");
    }
    lines.push(`${ind}⏰ ${triggers.join('  •  ')}`);
  } else if (sig.type === 'email') {
    const sender = extractName(payload.from) || '?';
    const email = extractEmail(payload.from) || '';
    const labels = Array.isArray(payload.labels) ? payload.labels.filter((l) => !/^Label_/i.test(l)) : [];
    const triggers = [`from: ${sender}${email ? ` <${email}>` : ''}`];
    if (payload.timestamp) triggers.push(`sent: ${fmtTimeShort(payload.timestamp)} (${relTime(payload.timestamp)})`);
    if (payload.threadId) triggers.push(`thread: ${(payload.subject || '').slice(0, 50)}`);
    if (labels.length) triggers.push(`labels: ${labels.join(', ')}`);
    if (payload.snippet) {
      const snip = payload.snippet.replace(/\s+/g, ' ').slice(0, 140);
      lines.push(`${ind}✉️  ${triggers.join('  •  ')}`);
      lines.push(`${ind}    "${snip}${payload.snippet.length > 140 ? '…' : ''}"`);
    } else {
      lines.push(`${ind}✉️  ${triggers.join('  •  ')}`);
    }
  } else if (sig.type === 'github_pr') {
    const triggers = [`repo: ${payload.repo || '?'}`, `#${payload.number || '?'} ${payload.state || ''}`.trim()];
    if (payload.requested_reviewers?.length) triggers.push(`reviewers: ${payload.requested_reviewers.join(', ')}`);
    if (payload.user_is_reviewer) triggers.push("you are reviewer");
    lines.push(`${ind}🔀 ${triggers.join('  •  ')}`);
  } else if (sig.type === 'github_issue') {
    lines.push(`${ind}🐛 repo: ${payload.repo || '?'}  •  #${payload.number || '?'}  •  assignee: ${payload.assignee_login || '?'}`);
  } else if (sig.type === 'slack_message') {
    lines.push(`${ind}💬 #${payload.channel || '?'}  •  from: ${payload.user || '?'}  •  ${payload.ts || ''}`);
  } else if (sig.type) {
    lines.push(`${ind}📡 ${sig.type} from ${sig.source}`);
  }

  // Why bullets
  const why = (ctx.why || []).filter(Boolean);
  if (why.length) {
    lines.push(`${ind}why: ${why.slice(0, 3).join(' | ')}`);
  }

  // Memory references (openloomi-memory)
  const memRefs = ctx.memory_refs || [];
  const person = ctx.person;
  const memPieces = [];
  if (person?.name) memPieces.push(`👤 ${person.name}${person.lastInteractionAt ? ` (last seen ${fmtTimeShort(person.lastInteractionAt)})` : ''}`);
  if (memRefs.length) {
    for (const ref of memRefs.slice(0, 3)) {
      if (typeof ref === 'string') memPieces.push(`🧠 ${ref}`);
      else if (ref.file) memPieces.push(`🧠 ${ref.file}${ref.line ? `:${ref.line}` : ''}`);
      else if (ref.title) memPieces.push(`🧠 "${ref.title.slice(0, 60)}"`);
    }
  }
  if (memPieces.length) lines.push(`${ind}context: ${memPieces.join('  •  ')}`);
  else if (person == null && !memRefs.length) {
    // Hint that memory enrichment was skipped (lib-level tick)
    lines.push(`${ind}context: (no memory refs — run \`loop tick\` for Claude to enrich)`);
  }

  // Suggested action
  const act = d.action || {};
  if (act.kind) {
    lines.push(`${ind}→ ${act.kind}${act.response ? ` (${act.response})` : ''}${act.params?.eventId ? `  evt=${act.params.eventId}` : ''}${act.params?.threadId ? `  thread=${act.params.threadId}` : ''}`);
  }

  return lines.join('\n');
}

function cmdInbox(args) {
  const limit = parseInt(args.flags.limit || '20', 10);
  const pick = args.flags.pick;
  const list = decisions.pending().slice(0, limit);
  if (!list.length) { console.log('(no pending decisions — run `loop analyze` or have Claude run `loop tick`)'); return; }

  if (pick) return interactivePick(list);
  console.log(`${list.length} pending decision(s):\n`);
  list.forEach((d, i) => console.log(fmtDecision(d, i)));
  console.log(`\nrun: \`openloomi-loop run <id>\`  or  \`openloomi-loop inbox --pick\``);
}

function interactivePick(list) {
  // Simple arrow-key picker using raw mode + readline
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  let idx = 0;
  const render = () => {
    process.stdout.write('\x1b[2J\x1b[H');
    console.log('↑/↓ to move, Enter to run, d to dismiss, q to quit\n');
    list.forEach((d, i) => {
      const marker = i === idx ? '▶ ' : '  ';
      process.stdout.write(`${marker + fmtDecision(d, i)}\n`);
    });
  };
  render();

  return new Promise((resolve) => {
    const onKey = (buf) => {
      const s = buf.toString();
      if (s === '\x1b[A' || s === 'k') { idx = Math.max(0, idx - 1); render(); }
      else if (s === '\x1b[B' || s === 'j') { idx = Math.min(list.length - 1, idx + 1); render(); }
      else if (s === '\r' || s === '\n') {
        process.stdin.setRawMode(false); process.stdin.removeListener('data', onKey);
        const choice = list[idx];
        console.log(`\n→ running ${choice.id}`);
        resolve(cmdRun({ _: ['run', choice.id], flags: {} }));
      }
      else if (s === 'd') {
        process.stdin.setRawMode(false); process.stdin.removeListener('data', onKey);
        const choice = list[idx];
        console.log(`\n→ dismissing ${choice.id}`);
        decisions.moveTo(choice.id, 'dismissed', { reason: 'user dismissed in picker' });
        resolve();
      }
      else if (s === 'q' || s === '\x1b') {
        process.stdin.setRawMode(false); process.stdin.removeListener('data', onKey);
        resolve();
      }
    };
    process.stdin.on('data', onKey);
  });
}

// ---------------------------------------------------------------------------
// Run / dismiss
// ---------------------------------------------------------------------------

function buildPrompt(decision) {
  const sig = decision.source_signal || {};
  const ctx = decision.context || {};
  const person = ctx.person;
  // De-dupe "why" entries; the person line is rendered separately
  const why = (ctx.why || []).filter((w) => !/^Known contact/i.test(w));
  const personLine = person
    ? `Known contact: ${person.name || '?'} <${person.emails?.[0] || '?'}>`
    : '';
  return `You are executing an openloomi Loop decision. The user picked this from a proactive suggestion list.

DECISION TYPE: ${decision.type}
TITLE: ${decision.title}
CONFIDENCE: ${(decision.confidence || 0).toFixed(2)}

WHY THIS SURFACED:
${why.length ? why.map((w) => `- ${w}`).join('\n') : '(no extra context)'}
${personLine ? `- ${personLine}` : ''}

SOURCE SIGNAL (${sig.source}:${sig.type}):
${JSON.stringify(sig.payload || {}, null, 2)}

SUGGESTED ACTION:
${JSON.stringify(decision.action || {}, null, 2)}

Execute this action now. Steps:
1. Confirm what you're about to do in one line.
2. Take the action (read files, draft replies, update tasks — whatever the action calls for).
3. When done, summarize in 3 bullets: what changed, what was written to memory, follow-ups.
4. If any step is destructive or sends externally, STOP and ask the user to confirm before continuing.`;
}

function cmdRun(args) {
  const id = args._[1];
  if (!id) { console.log('usage: openloomi-loop run <id> [--dry]'); return; }
  const dec = decisions.get(id);
  if (!dec) { console.log(`no such decision: ${id}`); return; }
  if (dec.status !== 'pending') { console.log(`decision ${id} is ${dec.status}`); return; }

  const prompt = buildPrompt(dec);
  if (args.flags.dry) {
    console.log('--- DRY RUN — would spawn claude with prompt ---\n');
    console.log(prompt);
    return;
  }

  decisions.update(id, { status: 'running', started_at: utils.now() });
  console.log(`spawning claude for decision ${id} (${dec.type})...`);

  // Try several ways to invoke claude code
  const candidates = process.env.LOOP_CLAUDE_BIN
    ? [process.env.LOOP_CLAUDE_BIN]
    : ['claude', 'claude-code', '/usr/local/bin/claude'];

  let child = null;
  for (const bin of candidates) {
    try {
      child = spawn(bin, ['-p', prompt, '--output-format', 'text'], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: process.env,
      });
      break;
    } catch (e) { /* try next */ }
  }
  if (!child) {
    console.log(`failed to spawn claude. Tried: ${candidates.join(', ')}.`);
    console.log("Set LOOP_CLAUDE_BIN env var to your claude binary.");
    decisions.update(id, { status: 'pending' }); // revert
    return;
  }

  child.on('exit', (code, signal) => {
    const ok = code === 0;
    decisions.moveTo(id, ok ? 'done' : 'dismissed', {
      ok,
      code,
      signal,
      summary: ok ? 'claude exited 0' : `claude exited ${code}/${signal}`,
    });
    console.log(`\n[loop] decision ${id} → ${ok ? 'done' : 'failed'} (${code}/${signal})`);
    // Note: any memory writeback happens in the executing Claude session itself
    // via the openloomi-memory skill (add-insight / add-memory). The loop CLI
    // does NOT maintain a local memory store.
  });
}

function cmdDismiss(args) {
  const id = args._[1];
  if (!id) { console.log('usage: openloomi-loop dismiss <id>'); return; }
  const ok = decisions.moveTo(id, 'dismissed', { reason: args.flags.reason || 'user' });
  if (!ok) console.log(`no such decision: ${id}`);
  else console.log(`dismissed ${id}`);
}

// ---------------------------------------------------------------------------
// One-shot pull / analyze / inject
// ---------------------------------------------------------------------------

async function cmdPull() {
  // In agentic mode, signal fetching is done by Claude via Composio MCP.
  // `loop pull` is kept as an alias for the lib-level tick so signals that
  // are already on disk (e.g. dropped into data/inbox/) get classified.
  const before = signals.list({ limit: 100000 }).length;
  const status = daemon.tick();
  const after = signals.list({ limit: 100000 }).length;
  console.log("mode: agentic (use \`loop tick\` to fetch via Claude MCP)");
  console.log(`lib-tick: signals=${before} → ${after}  created=${status.last_tick.created}  skipped=${status.last_tick.skipped}`);
}

async function cmdAnalyze() {
  const status = await daemon.tick();
  console.log(JSON.stringify(status, null, 2));
}

function cmdInject(args) {
  const target = args._[1];
  if (!target) { console.log('usage: openloomi-loop inject <file.json|->'); return; }
  const inbox = path.join(paths.DATA_DIR, 'inbox');
  fs.mkdirSync(inbox, { recursive: true });

  if (target === '-' || target === '/dev/stdin') {
    const data = fs.readFileSync(0, 'utf8');
    const fname = `${utils.now().replace(/[:.]/g, '-')}-stdin.json`;
    fs.writeFileSync(path.join(inbox, fname), data);
    console.log(`dropped → ${path.join(inbox, fname)}`);
    return;
  }
  if (!fs.existsSync(target)) { console.log(`no such file: ${target}`); return; }
  const fname = path.basename(target);
  fs.copyFileSync(target, path.join(inbox, fname));
  console.log(`copied → ${path.join(inbox, fname)}`);
}

// ---------------------------------------------------------------------------
// Memory + decisions listing
// ---------------------------------------------------------------------------

function cmdMemory(args) {
  // The loop skill does NOT maintain its own memory store. Delegate to
  // openloomi-memory (which has its own SKILL.md, scripts, and CLI).
  const MEM_SKILL = path.resolve(__dirname, '../../openloomi-memory/scripts/openloomi-memory.cjs');
  if (!fs.existsSync(MEM_SKILL)) {
    console.log(`openloomi-memory skill not found at ${MEM_SKILL}`);
    console.log("Install it under skills/openloomi-memory/ to use \`loop memory\`.");
    return;
  }
  // The openloomi-memory CLI reads positional args first (args[0] = query).
  // Build the command line so the query comes BEFORE any flags.
  const sub = args._[1] || 'search-all';
  const positionals = args._.slice(2);   // free-form query / id / etc.
  const flagPairs = [];
  for (const [k, v] of Object.entries(args.flags)) {
    if (v === true) flagPairs.push(`--${k}`);
    else flagPairs.push(`--${k}=${v}`);
  }
  const forward = [sub, ...positionals, ...flagPairs];
  const r = spawnSync(process.execPath, [MEM_SKILL, ...forward], { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  if (r.status !== 0) process.stderr.write(r.stderr);
}

function cmdDecisions(args) {
  const status = args.flags.status || 'all';
  const list = decisions.list(status === 'all' ? null : status);
  if (!list.length) { console.log(`(no ${status} decisions)`); return; }
  console.log(`${list.length} ${status} decisions:\n`);
  list.slice(0, 100).forEach((d, i) => console.log(fmtDecision(d, i)));
}

function cmdDecision(args) {
  const id = args._[1];
  if (!id) { console.log('usage: openloomi-loop decision <id>'); return; }
  const d = decisions.get(id);
  if (!d) { console.log(`no such decision: ${id}`); return; }
  console.log(JSON.stringify(d, null, 2));
}

// ---------------------------------------------------------------------------
// Config + logs
// ---------------------------------------------------------------------------

function cmdConfig(args) {
  const sub = args._[1] || 'get';
  if (sub === 'get') {
    console.log(JSON.stringify(config.read(), null, 2));
    return;
  }
  if (sub === 'set') {
    const k = args._[2]; const v = args._[3];
    if (!k || v == null) { console.log('usage: openloomi-loop config set <key> <value>'); return; }
    const cfg = config.read();
    // Coerce numbers
    if (typeof config.defaults()[k] === 'number') cfg[k] = Number(v);
    else if (v === 'true') cfg[k] = true;
    else if (v === 'false') cfg[k] = false;
    else cfg[k] = v;
    config.write(cfg);
    console.log(`set ${k} = ${cfg[k]}`);
    return;
  }
  console.log('usage: openloomi-loop config [get|set <k> <v>]');
}

function cmdLogs(args) {
  const n = Number.parseInt(args.flags.n || '50', 10);
  if (!fs.existsSync(paths.LOG_PATH)) { console.log('(no log file)'); return; }
  const lines = fs.readFileSync(paths.LOG_PATH, 'utf8').split('\n').filter(Boolean);
  console.log(lines.slice(-n).join('\n'));
}

// ---------------------------------------------------------------------------
// REPL: `loop serve` — show inbox, accept numbers, run them, loop
// ---------------------------------------------------------------------------

async function cmdServe() {
  console.log('openloomi-loop REPL. Commands: list | run <id> | dismiss <id> | pull | status | quit');
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  const rl = require('node:readline').createInterface({ input: process.stdin, output: process.stdout, prompt: 'loop> ' });
  rl.prompt();
  rl.on('line', async (line) => {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    try {
      if (cmd === 'list' || cmd === 'inbox') cmdInbox({ _: [], flags: {} });
      else if (cmd === 'run') cmdRun({ _: [rest[0]], flags: {} });
      else if (cmd === 'dismiss') cmdDismiss({ _: [rest[0]], flags: {} });
      else if (cmd === 'pull') await cmdPull();
      else if (cmd === 'status') cmdStatus();
      else if (cmd === 'quit' || cmd === 'q') { rl.close(); return; }
      else if (cmd) console.log(`unknown: ${cmd}`);
    } catch (e) {
      console.log(`error: ${e.message}`);
    }
    rl.prompt();
  });
  rl.on('close', () => process.exit(0));
}

// ---------------------------------------------------------------------------
// Web — HTTP server with REST API + static UI (Ink & Circuit style)
// ---------------------------------------------------------------------------

function cmdWeb(args) {
  // Delegate to scripts/loop-web.cjs (separate process for clean signal handling).
  const port = args.flags.port || process.env.LOOP_WEB_PORT || args._[1] || '3414';
  const open = args.flags.open !== false && !args.flags['no-open'];
  const child = spawn(
    process.execPath,
    [path.join(__dirname, 'loop-web.cjs'), String(port)],
    { stdio: 'inherit', env: process.env },
  );
  if (open) {
    const url = `http://127.0.0.1:${port}/`;
    setTimeout(() => {
      try { spawn('open', [url], { stdio: 'ignore', detached: true }).unref(); } catch {}
    }, 600);
  }
  child.on('exit', (code) => process.exit(code ?? 0));
}

async function main() {
  paths.ensureDirs();
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  try {
    switch (cmd) {
      case 'tick':             return cmdTick(args);
      case 'schedule':         return cmdSchedule(args);
      case 'watch':            return await cmdWatch(args);
      case 'notify':           return cmdNotify(args);
      case 'ingest-decision':  return cmdIngestDecision(args);
      case 'status':           return cmdStatus();
      case 'inbox':            return cmdInbox(args);
      case 'analyze':          return await cmdAnalyze();
      case 'decisions':        return cmdDecisions(args);
      case 'decision':         return cmdDecision(args);
      case 'run':              return cmdRun(args);
      case 'dismiss':          return cmdDismiss(args);
      case 'inject':           return cmdInject(args);
      case 'pull':             return await cmdPull();
      case 'memory':           return cmdMemory(args);
      case 'config':           return cmdConfig(args);
      case 'logs':             return cmdLogs(args);
      case 'serve':            return await cmdServe();
      case 'web':              return cmdWeb(args);
      case 'summary':          return cmdSummary(args);
      case undefined:
      case 'help':
      case '-h':
      case '--help':
        return usage();
      default:
        console.log(`unknown command: ${cmd}\n`);
        usage();
    }
  } catch (e) {
    console.error(`error: ${e.stack || e.message}`);
    process.exit(1);
  }
}

main();
