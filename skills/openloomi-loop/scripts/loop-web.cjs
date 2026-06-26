#!/usr/bin/env node
// openloomi-loop web — static UI + REST API on http://localhost:<port>
// Endpoints:
//   GET  /                         → web/index.html
//   GET  /api/state                → counts, last tick, status
//   GET  /api/decisions            → all decisions (pending/done/dismissed)
//   GET  /api/decision/:id         → full decision JSON
//   GET  /api/signals?limit=50     → tail signals.jsonl
//   GET  /api/notifications?limit=50 → tail notifications.log
//   GET  /api/memory?path=rel      → read a memory file (relative to ~/.openloomi/data/memory)
//   GET  /api/source?path=rel      → read a raw source signal file (data/inbox/...)
//   POST /api/run/:id[?dry=1]      → spawn `claude -p <prompt>` (or --dry)
//   POST /api/dismiss/:id          → mark dismissed
//   POST /api/notify               → fire a manual notification test

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const url = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const SKILL_DIR = ROOT;
const DATA_DIR = path.join(SKILL_DIR, 'data');
const WEB_DIR = path.join(SKILL_DIR, 'web');
const MEMORY_DIR = path.join(os.homedir(), '.openloomi', 'data', 'memory');

const DECISIONS_PATH = path.join(DATA_DIR, 'decisions.json');
const SIGNALS_PATH = path.join(DATA_DIR, 'signals.jsonl');
const NOTIFY_LOG = path.join(DATA_DIR, 'notifications.log');
const NOTIFY_SEEN = path.join(DATA_DIR, 'notifications.seen.json');
const STATUS_PATH = path.join(DATA_DIR, 'status.json');
const DRAFT_DIR = path.join(DATA_DIR, 'drafts');

const PORT = parseInt(process.env.LOOP_WEB_PORT || process.argv[2] || '3414', 10);
const HOST = process.env.LOOP_WEB_HOST || '127.0.0.1';

// --- helpers -----------------------------------------------------------------

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function readJsonlTail(p, limit) {
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  return lines.slice(-limit).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}
function readLogTail(p, limit) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-limit);
}
function safeResolve(base, rel) {
  // Prevent path traversal — rel must resolve inside base.
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(base + path.sep) && abs !== base) return null;
  return abs;
}
function jsonRes(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(obj));
}
function textRes(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
function findDecision(id) {
  const d = readJson(DECISIONS_PATH, { pending: [], done: [], dismissed: [] });
  for (const bucket of ['pending', 'done', 'dismissed']) {
    const found = (d[bucket] || []).find((x) => x.id === id);
    if (found) return { dec: found, bucket, store: d };
  }
  return null;
}
function moveDecision(id, toBucket) {
  const d = readJson(DECISIONS_PATH, { pending: [], done: [], dismissed: [] });
  let moved = null;
  for (const bucket of ['pending', 'done', 'dismissed']) {
    const i = (d[bucket] || []).findIndex((x) => x.id === id);
    if (i >= 0) {
      moved = d[bucket].splice(i, 1)[0];
      moved.status = toBucket;
      moved.movedAt = new Date().toISOString();
      d[toBucket] = d[toBucket] || [];
      d[toBucket].unshift(moved);
      break;
    }
  }
  if (!moved) return null;
  const tmp = DECISIONS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, DECISIONS_PATH);
  return moved;
}
function buildRunPrompt(dec) {
  const sig = dec.source_signal || {};
  const why = (dec.context?.why || []).join('\n- ');
  return `You are executing an openloomi Loop decision. The user picked this from a proactive suggestion list.

DECISION TYPE: ${dec.type}
TITLE: ${dec.title}
CONFIDENCE: ${dec.confidence ?? '?'}

WHY THIS SURFACED:
- ${why}

${sig.id ? `SOURCE SIGNAL (${sig.source}:${sig.type}):\n${JSON.stringify(sig, null, 2)}\n` : ''}SUGGESTED ACTION:
${JSON.stringify(dec.action, null, 2)}

${dec.context?.person ? `KNOWN CONTACT:\n- ${dec.context.person.name} <${dec.context.person.email}>\n` : ''}${dec.context?.memory_refs?.length ? `MEMORY REFS (openloomi-memory):\n- ${dec.context.memory_refs.join('\n- ')}\n` : ''}
Execute this action now. Steps:
1. Confirm what you're about to do in one line.
2. Take the action (read files, draft replies, update tasks — whatever the action calls for).
3. When done, summarize in 3 bullets: what changed, what was written to memory, follow-ups.
4. If any step is destructive or sends externally, STOP and ask the user to confirm before continuing.

For any new people or insights discovered, use the openloomi-memory skill:
  node $OPENLOOMI_MEMORY_DIR/scripts/openloomi-memory.cjs add-memory ...
  node $OPENLOOMI_MEMORY_DIR/scripts/openloomi-memory.cjs add-insight ...
`;
}

// --- routes ------------------------------------------------------------------

function handleState(req, res) {
  const dec = readJson(DECISIONS_PATH, { pending: [], done: [], dismissed: [] });
  const status = readJson(STATUS_PATH, {});
  let signalsCount = 0;
  try {
    if (fs.existsSync(SIGNALS_PATH)) {
      signalsCount = fs.readFileSync(SIGNALS_PATH, 'utf8').split('\n').filter(Boolean).length;
    }
  } catch {}
  jsonRes(res, 200, {
    counts: {
      pending: dec.pending.length,
      done: dec.done.length,
      dismissed: dec.dismissed.length,
      signals: signalsCount,
    },
    last_tick: status.last_tick || null,
    mode: status.mode || 'agentic',
    data_dir: DATA_DIR,
    memory_dir: MEMORY_DIR,
    drafts: fs.existsSync(DRAFT_DIR) ? fs.readdirSync(DRAFT_DIR).filter((f) => !f.startsWith('.')) : [],
  });
}

function handleListDecisions(req, res) {
  const d = readJson(DECISIONS_PATH, { pending: [], done: [], dismissed: [] });
  jsonRes(res, 200, d);
}

function handleGetDecision(req, res, id) {
  const f = findDecision(id);
  if (!f) return jsonRes(res, 404, { error: 'not_found', id });
  jsonRes(res, 200, { decision: f.dec, bucket: f.bucket });
}

function handleSignals(req, res, q) {
  const limit = Math.min(parseInt(q.limit || '50', 10), 500);
  jsonRes(res, 200, { signals: readJsonlTail(SIGNALS_PATH, limit) });
}

function handleNotifications(req, res, q) {
  const limit = Math.min(Number.parseInt(q.limit || '50', 10), 500);
  jsonRes(res, 200, { lines: readLogTail(NOTIFY_LOG, limit) });
}

function handleMemory(req, res, q) {
  if (!q.path) return jsonRes(res, 400, { error: 'missing_path' });
  const abs = safeResolve(MEMORY_DIR, q.path);
  if (!abs) return jsonRes(res, 403, { error: 'path_outside_memory_dir' });
  if (!fs.existsSync(abs)) return jsonRes(res, 404, { error: 'not_found', path: abs });
  const body = fs.readFileSync(abs, 'utf8');
  jsonRes(res, 200, { path: q.path, abs, body });
}

function handleSource(req, res, q) {
  if (!q.path) return jsonRes(res, 400, { error: 'missing_path' });
  // data/inbox files (or .processed / .failed)
  const inboxBase = path.join(DATA_DIR, 'inbox');
  const abs = safeResolve(inboxBase, q.path);
  if (!abs) return jsonRes(res, 403, { error: 'path_outside_inbox' });
  if (!fs.existsSync(abs)) return jsonRes(res, 404, { error: 'not_found', path: abs });
  const body = fs.readFileSync(abs, 'utf8');
  jsonRes(res, 200, { path: q.path, abs, body });
}

function handleRun(req, res, id) {
  const f = findDecision(id);
  if (!f) return jsonRes(res, 404, { error: 'not_found', id });
  const dry = url.parse(req.url, true).query.dry === '1';
  const prompt = buildRunPrompt(f.dec);
  if (dry) {
    return jsonRes(res, 200, { dry: true, prompt, decision: f.dec });
  }
  // Spawn claude -p (or LOOP_CLAUDE_BIN)
  const claudeBin = process.env.LOOP_CLAUDE_BIN || 'claude';
  try {
    const child = spawn(claudeBin, ['-p', prompt, '--output-format', 'text'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    return jsonRes(res, 202, { ok: true, spawned: child.pid, bin: claudeBin });
  } catch (e) {
    return jsonRes(res, 500, { error: 'spawn_failed', message: e.message });
  }
}

function handleDismiss(req, res, id) {
  const moved = moveDecision(id, 'dismissed');
  if (!moved) return jsonRes(res, 404, { error: 'not_found', id });
  jsonRes(res, 200, { ok: true, moved });
}

function handleMarkDone(req, res, id) {
  const moved = moveDecision(id, 'done');
  if (!moved) return jsonRes(res, 404, { error: 'not_found', id });
  jsonRes(res, 200, { ok: true, moved });
}

function handleNotify(req, res) {
  // Fire a desktop notification (test channel) — wraps the same notifyDesktop()
  if (process.platform !== 'darwin') return jsonRes(res, 501, { error: 'desktop_unsupported' });
  const r = spawnSync('osascript', [
    '-e',
    `display notification "openloomi-loop web · manual ping" with title "openloomi-loop" subtitle "web test" sound name "default"`,
  ], { encoding: 'utf8', timeout: 3000 });
  jsonRes(res, 200, { ok: r.status === 0, exit: r.status, stderr: r.stderr });
}

function serveStatic(req, res, pathname) {
  // Map "/" to index.html
  let rel = pathname === '/' ? '/index.html' : pathname;
  const abs = safeResolve(WEB_DIR, '.' + rel);
  if (!abs) return textRes(res, 403, 'forbidden');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return textRes(res, 404, 'not found');
  }
  const ext = path.extname(abs).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
    '.txt':  'text/plain; charset=utf-8',
  };
  textRes(res, 200, fs.readFileSync(abs), types[ext] || 'application/octet-stream');
}

// --- server ------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const q = parsed.query;
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // API routes
  if (pathname === '/api/state' && method === 'GET') return handleState(req, res);
  if (pathname === '/api/decisions' && method === 'GET') return handleListDecisions(req, res);
  if (pathname === '/api/signals' && method === 'GET') return handleSignals(req, res, q);
  if (pathname === '/api/notifications' && method === 'GET') return handleNotifications(req, res, q);
  if (pathname === '/api/memory' && method === 'GET') return handleMemory(req, res, q);
  if (pathname === '/api/source' && method === 'GET') return handleSource(req, res, q);
  if (pathname === '/api/notify' && method === 'POST') return handleNotify(req, res);

  const mDecision = pathname.match(/^\/api\/decision\/([A-Za-z0-9_-]+)$/);
  if (mDecision && method === 'GET') return handleGetDecision(req, res, mDecision[1]);

  const mRun = pathname.match(/^\/api\/run\/([A-Za-z0-9_-]+)$/);
  if (mRun && method === 'POST') return handleRun(req, res, mRun[1]);

  const mDismiss = pathname.match(/^\/api\/dismiss\/([A-Za-z0-9_-]+)$/);
  if (mDismiss && method === 'POST') return handleDismiss(req, res, mDismiss[1]);

  const mDone = pathname.match(/^\/api\/done\/([A-Za-z0-9_-]+)$/);
  if (mDone && method === 'POST') return handleMarkDone(req, res, mDone[1]);

  // Static
  if (method === 'GET') return serveStatic(req, res, pathname);

  textRes(res, 405, 'method not allowed');
});

server.listen(PORT, HOST, () => {
  console.log(`openloomi-loop web`);
  console.log(`  url:    http://${HOST}:${PORT}/`);
  console.log(`  data:   ${DATA_DIR}`);
  console.log(`  memory: ${MEMORY_DIR}`);
  console.log(`Press Ctrl+C to stop.\n`);
});
