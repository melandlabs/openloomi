#!/usr/bin/env node
/**
 * openloomi-loop shared library
 * Common helpers for daemon, CLI, and skill runtime.
 *
 * Exports:
 *   paths             - data dir + file paths
 *   token             - read ~/.openloomi/token
 *   api               - http request to openloomi-api (3414/3515)
 *   signals           - append/read signals (JSONL)
 *   decisions         - add/list/get/update decisions
 *   rules             - hard-rule filters + decision classifiers
 *   now / uid / log   - small utilities
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { URL } = require('node:url');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const SKILL_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(SKILL_DIR, 'data');
const SIGNALS_PATH = path.join(DATA_DIR, 'signals.jsonl');
const DECISIONS_PATH = path.join(DATA_DIR, 'decisions.json');
const STATUS_PATH = path.join(DATA_DIR, 'status.json');
const PID_PATH = path.join(DATA_DIR, 'daemon.pid');
const LOG_PATH = path.join(DATA_DIR, 'daemon.log');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const TOKEN_PATH = path.join(os.homedir(), '.openloomi', 'token');
const API_PORTS = [3414, 3515, 3415];

function ensureDirs() {
  const subs = [
    DATA_DIR,
    path.join(DATA_DIR, 'inbox'),
    path.join(DATA_DIR, 'inbox', '.processed'),
    path.join(DATA_DIR, 'inbox', '.failed'),
    path.join(DATA_DIR, 'drafts'),
  ];
  for (const d of subs) fs.mkdirSync(d, { recursive: true });
}

const paths = {
  SKILL_DIR,
  DATA_DIR,
  SIGNALS_PATH,
  DECISIONS_PATH,
  STATUS_PATH,
  PID_PATH,
  LOG_PATH,
  CONFIG_PATH,
  ensureDirs,
};

// ---------------------------------------------------------------------------
// Small utils
// ---------------------------------------------------------------------------

function now() {
  return new Date().toISOString();
}

// Strip CLAUDECODE / nested-session markers from a copy of process.env
// before spawning a child. The Claude Code runtime sets CLAUDECODE in any
// session it starts; a child that inherits it refuses to launch with
// "nested session detected" — relevant for any child spawned from inside
// an openloomi session (loop-web, legacy `claude -p`, etc.).
function cleanChildEnv() {
  const env = { ...process.env };
  env.CLAUDECODE = undefined;
  return env;
}

function uid(prefix = 'id') {
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${r}`;
}

function log(line) {
  ensureDirs();
  const stamp = new Date().toISOString();
  fs.appendFileSync(LOG_PATH, `[${stamp}] ${line}\n`);
}

function readJson(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(p, obj) {
  ensureDirs();
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const line of lines) {
    try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return out;
}

function appendJsonl(p, obj) {
  ensureDirs();
  fs.appendFileSync(p, `${JSON.stringify(obj)}\n`);
}

// ---------------------------------------------------------------------------
// Token + API
// ---------------------------------------------------------------------------

function readToken() {
  try {
    const encoded = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
    return Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function apiRequest(endpoint, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const token = readToken();
    let portIdx = 0;
    const tryPort = () => {
      if (portIdx >= API_PORTS.length) {
        resolve({ ok: false, error: `openloomi-api not reachable (tried ${API_PORTS.join(',')})` });
        return;
      }
      const port = API_PORTS[portIdx++];
      let url;
      try { url = new URL(endpoint, `http://localhost:${port}`); }
      catch { resolve({ ok: false, error: `bad endpoint ${endpoint}` }); return; }
      const opts = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
      };
      const req = http.request(opts, (res) => {
        let data = '';
        // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ ok: res.statusCode < 400, status: res.statusCode, data: json });
          } catch {
            resolve({ ok: res.statusCode < 400, status: res.statusCode, data });
          }
        });
      });
      req.on('error', () => tryPort());
      req.setTimeout(2500, () => req.destroy(new Error('timeout')));
      if (body) req.write(JSON.stringify(body));
      req.end();
    };
    tryPort();
  });
}

const api = { request: apiRequest, readToken };

// ---------------------------------------------------------------------------
// Agent runtime
//   - Surface A (default): POST to the local native-agent endpoint and parse
//     the SSE response. Keeps the loop inside the openloomi process tree
//     (no nested `claude` child) and works from any cwd.
//   - Surface B (fallback): spawn `claude -p` as a child process. Opt in by
//     setting `LOOP_LEGACY=1`. Useful for debugging tick behavior in a real
//     TTY or when the native-agent endpoint is down.
// ---------------------------------------------------------------------------

const NATIVE_AGENT_DEFAULT_URL = 'http://127.0.0.1:3414/api/native/agent';

function resolveNativeAgentUrl() {
  return (process.env.LOOP_NATIVE_AGENT_URL || NATIVE_AGENT_DEFAULT_URL).replace(/\/+$/, '');
}

// POST to the local native-agent endpoint and parse the SSE response.
// Returns:
//   { ok, status, text, reasoning, result, events, error }
// `onEvent(evt)` is called for every parsed SSE event (text, reasoning,
// tool_use, tool_result, result, done, ...).
function postNativeAgent(urlStr, body, { timeoutMs, onEvent } = {}) {
  return new Promise((resolve) => {
    const token = readToken();
    let parsed;
    try { parsed = new URL(urlStr); }
    catch { resolve({ ok: false, error: `bad url ${urlStr}` }); return; }
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      if (res.statusCode >= 400) {
        let err = '';
        res.on('data', (c) => (err += c));
        res.on('end', () => resolve({ ok: false, status: res.statusCode, error: err || `HTTP ${res.statusCode}` }));
        return;
      }
      const events = [];
      const textChunks = [];
      const reasoningChunks = [];
      let result = null;
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).replace(/\r$/, '');
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let evt;
          try { evt = JSON.parse(payload); } catch { continue; }
          events.push(evt);
          if (typeof onEvent === 'function') onEvent(evt);
          if (evt.type === 'text' && typeof evt.content === 'string') textChunks.push(evt.content);
          else if (evt.type === 'reasoning' && typeof evt.content === 'string') reasoningChunks.push(evt.content);
          else if (evt.type === 'result' && evt.content) result = evt.content;
        }
      });
      res.on('end', () => resolve({
        ok: true, status: res.statusCode,
        text: textChunks.join(''),
        reasoning: reasoningChunks.join(''),
        result, events,
      }));
      res.on('error', (err) => resolve({ ok: false, error: err.message }));
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.setTimeout(timeoutMs || 15 * 60 * 1000, () => req.destroy(new Error('native agent timeout')));
    req.write(JSON.stringify(body));
    req.end();
  });
}

// Build a default `onEvent` handler that streams agent text + tool calls to
// the terminal. Every text chunk is written as it arrives, plus a short
// line for each tool_use / tool_result so the user sees progress (matches
// the streaming experience of `claude -p --verbose` stdio=inherit).
function defaultStreamOnEvent({ showReasoning = false } = {}) {
  return (evt) => {
    if (evt.type === 'text' && typeof evt.content === 'string') {
      process.stdout.write(evt.content);
    } else if (evt.type === 'reasoning' && showReasoning && typeof evt.content === 'string') {
      process.stderr.write(`\x1b[2m${evt.content}\x1b[0m`);
    } else if (evt.type === 'tool_use') {
      const name = evt.name || 'tool';
      const input = evt.input ? JSON.stringify(evt.input).slice(0, 120) : '';
      process.stderr.write(`\n  → ${name} ${input}\n`);
    } else if (evt.type === 'tool_result') {
      const ok = evt.isError ? '✗' : '✓';
      const out = (evt.output || '').toString().slice(0, 160).replace(/\n/g, ' ');
      process.stderr.write(`  ${ok} ${out}${out.length === 160 ? '…' : ''}\n`);
    } else if (evt.type === 'result' && evt.content) {
      const c = evt.content;
      if (typeof c.cost === 'number') process.stderr.write(`\n[agent] cost=$${c.cost.toFixed(4)} duration=${c.duration}ms\n`);
    }
  };
}

// Surface A entry point — POST to /api/native/agent and resolve when the
// SSE stream ends. Returns the same shape `postNativeAgent` returns.
async function nativeAgentInvoke(prompt, opts = {}) {
  const url = resolveNativeAgentUrl();
  const body = {
    prompt,
    ...(opts.provider ? { provider: opts.provider } : {}),
    ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
  };
  const timeoutMs = opts.timeoutMs
    || Number(process.env.LOOP_NATIVE_AGENT_TIMEOUT_MS)
    || 15 * 60 * 1000;
  return postNativeAgent(url, body, { timeoutMs, onEvent: opts.onEvent });
}

// Surface B fallback — spawn `claude -p` and resolve when the child exits.
// Returns { ok, surface, child, code, signal, bin, args, error, timedOut }.
// `opts.timeoutMs` enforces a hard kill (SIGTERM, then SIGKILL after 5s).
function spawnClaudeLegacy(prompt, opts = {}) {
  return new Promise((resolve) => {
    const baseArgs = ['-p', prompt, '--output-format', 'text', '--verbose'];
    if (process.env.LOOP_CLAUDE_SAFE_PERMISSIONS !== '1') {
      baseArgs.push('--dangerously-skip-permissions');
    }
    baseArgs.push(...(opts.extraArgs || []));
    const bin = process.env.LOOP_CLAUDE_BIN || 'claude';
    const env = { ...process.env };
    env.CLAUDECODE = undefined;
    let child;
    try {
      child = spawn(bin, baseArgs, {
        stdio: opts.stdio || 'inherit',
        cwd: opts.cwd || process.cwd(),
        env,
      });
    } catch (e) {
      resolve({ ok: false, surface: 'legacy', error: e.message, bin, args: baseArgs });
      return;
    }
    let resolved = false;
    let killTimer = null;
    let escalateTimer = null;
    const settle = (payload) => {
      if (resolved) return;
      resolved = true;
      if (killTimer) clearTimeout(killTimer);
      if (escalateTimer) clearTimeout(escalateTimer);
      resolve({ ...payload, child, bin, args: baseArgs });
    };
    child.on('error', (e) => settle({ ok: false, error: e.message }));
    child.on('exit', (code, signal) => settle({ ok: code === 0, code, signal }));
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      killTimer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch {}
        escalateTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
      }, opts.timeoutMs);
    }
  });
}

// Unified entry point. Default = Surface A. `LOOP_LEGACY=1` (or
// `opts.legacy = true`) switches to Surface B (`spawn claude -p`).
// `opts.timeoutMs` is forwarded to both surfaces (native: HTTP socket
// timeout; legacy: SIGTERM after timeoutMs + SIGKILL after another 5s).
async function agentInvoke(prompt, opts = {}) {
  if (process.env.LOOP_LEGACY === '1' || opts.legacy) {
    return spawnClaudeLegacy(prompt, opts);
  }
  return nativeAgentInvoke(prompt, opts);
}

const agent = {
  invoke: agentInvoke,
  native: {
    invoke: nativeAgentInvoke,
    resolveUrl: resolveNativeAgentUrl,
  },
  legacy: {
    spawn: spawnClaudeLegacy,
    isForced: () => process.env.LOOP_LEGACY === '1',
  },
  defaultStreamOnEvent,
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function defaultConfig() {
  return {
    intervalSec: 600, // 10 minutes
    maxSignals: 5000,
    maxDecisions: 500,
    autoRun: false,
    enableSources: {
      composio: true,    // primary: ~/.composio/composio CLI
      openloomi: true,   // optional fallback: localhost:3414 API
      file: true,        // data/inbox/*.json drop folder
    },
    noReplySkip: true,
    promotionSkip: true,
  };
}

function readConfig() {
  ensureDirs();
  const file = readJson(CONFIG_PATH, {});
  return { ...defaultConfig(), ...file };
}

function writeConfig(cfg) {
  writeJsonAtomic(CONFIG_PATH, cfg);
}

// ---------------------------------------------------------------------------
// Signals (JSONL append-only)
// ---------------------------------------------------------------------------

const signals = {
  append(source, type, payload, extra = {}) {
    const sig = { id: uid('sig'), ts: now(), source, type, payload, ...extra };
    appendJsonl(SIGNALS_PATH, sig);
    return sig;
  },
  list({ since, source, limit = 200 } = {}) {
    let all = readJsonl(SIGNALS_PATH);
    if (since) all = all.filter((s) => s.ts >= since);
    if (source) all = all.filter((s) => s.source === source);
    return all.slice(-limit);
  },
  trim(max) {
    if (!fs.existsSync(SIGNALS_PATH)) return;
    const lines = fs.readFileSync(SIGNALS_PATH, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= max) return;
    const kept = lines.slice(-max);
    fs.writeFileSync(SIGNALS_PATH, `${kept.join('\n')}\n`);
  },
};

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

// Schema contract: `memory_refs` and `insight_refs` live INSIDE `context`.
// Some agent emits put them at the top level of the decision object. This
// hoists them into `context` so every consumer (CLI inbox formatter, webhook
// payload, run-prompt builder, web UI) sees one consistent shape regardless
// of how the decision was originally emitted. Mutates and returns the same
// object — callers can chain or assign. Idempotent: no-op when already nested.
function normalizeDecision(dec) {
  if (!dec || typeof dec !== 'object') return dec;
  if (!dec.context || typeof dec.context !== 'object') dec.context = {};
  const ctx = dec.context;
  for (const k of ['memory_refs', 'insight_refs']) {
    if (Array.isArray(dec[k]) && dec[k].length) {
      if (!Array.isArray(ctx[k])) ctx[k] = [];
      for (const v of dec[k]) {
        if (!ctx[k].includes(v)) ctx[k].push(v);
      }
      delete dec[k];
    }
  }
  return dec;
}

function readDecisions() {
  ensureDirs();
  const d = readJson(DECISIONS_PATH, { pending: [], done: [], dismissed: [] });
  // Defensive: hoist any top-level memory_refs/insight_refs on read so the
  // CLI, web, and webhook formatters all see the schema-correct shape even
  // for legacy on-disk records that pre-date the contract.
  for (const bucket of ['pending', 'done', 'dismissed']) {
    if (Array.isArray(d[bucket])) for (const dec of d[bucket]) normalizeDecision(dec);
  }
  return d;
}

function writeDecisions(d) {
  writeJsonAtomic(DECISIONS_PATH, d);
}

const decisions = {
  list(status = null) {
    const d = readDecisions();
    if (!status) return [...d.pending, ...d.done, ...d.dismissed];
    return d[status] || [];
  },
  pending() { return readDecisions().pending; },
  add(decision) {
    const d = readDecisions();
    normalizeDecision(decision);
    decision.id = decision.id || uid('dec');
    decision.ts = decision.ts || now();
    decision.status = decision.status || 'pending';
    d.pending.unshift(decision);
    writeDecisions(d);
    return decision;
  },
  get(id) {
    const d = readDecisions();
    return [...d.pending, ...d.done, ...d.dismissed].find((x) => x.id === id) || null;
  },
  update(id, patch) {
    const d = readDecisions();
    for (const bucket of ['pending', 'done', 'dismissed']) {
      const idx = d[bucket].findIndex((x) => x.id === id);
      if (idx >= 0) {
        d[bucket][idx] = { ...d[bucket][idx], ...patch };
        writeDecisions(d);
        return d[bucket][idx];
      }
    }
    return null;
  },
  moveTo(id, bucket, result = null) {
    const d = readDecisions();
    for (const src of ['pending', 'done', 'dismissed']) {
      const idx = d[src].findIndex((x) => x.id === id);
      if (idx >= 0) {
        const item = { ...d[src][idx], status: bucket, result, completed_at: now() };
        d[src].splice(idx, 1);
        d[bucket].unshift(item);
        writeDecisions(d);
        return item;
      }
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Rules: hard filters + decision classifiers
// ---------------------------------------------------------------------------

const NORELY_RE = /^(no-?reply|noreply|donotreply|notifications?@|mailer-daemon@|postmaster@)/i;
const PROMO_LABELS = ['promotions', 'social', 'forums', 'updates', 'spam'];
const SKIP_SENDERS = new Set();

function isHardSkipped(signal, cfg) {
  const p = signal.payload || {};
  if (cfg.noReplySkip) {
    const from = (p.from || p.sender || p.organizer || '').toString();
    if (NORELY_RE.test(from)) return `no-reply sender: ${from}`;
    if (SKIP_SENDERS.has(from.toLowerCase())) return `skip-list sender: ${from}`;
  }
  if (cfg.promotionSkip) {
    const labels = (p.labels || []).map((l) => String(l).toLowerCase());
    if (labels.some((l) => PROMO_LABELS.includes(l))) return `promo label: ${labels.join(',')}`;
  }
  // Calendar already accepted/declined
  if (signal.type === 'calendar_event') {
    if (p.my_response && ['accepted', 'declined', 'tentative'].includes(String(p.my_response).toLowerCase())) {
      return `already ${p.my_response}`;
    }
  }
  // Already replied email
  if (signal.type === 'email' && p.replied) return 'already replied';
  return null;
}

// Lightweight classifier: produces a decision candidate from a signal
function classify(signal) {
  const p = signal.payload || {};
  const text = `${p.subject || ''} ${p.snippet || p.body || ''}`.toLowerCase();

  // Calendar RSVP
  if (signal.type === 'calendar_event') {
    if (p.my_response === 'needsAction' || !p.my_response) {
      return {
        type: 'rsvp',
        title: `RSVP — ${p.title || p.summary || 'Meeting'}`,
        action: {
          kind: 'calendar_rsvp',
          params: {
            eventId: p.eventId || p.id,
            response: 'accepted',
          },
        },
      };
    }
  }

  // GitHub PR review
  if (signal.type === 'github_pr' && p.state === 'open') {
    if ((p.requested_reviewers || []).length === 0 && p.user_is_reviewer) {
      return {
        type: 'review_pr',
        title: `Review PR #${p.number} — ${p.title}`,
        action: {
          kind: 'github_review',
          params: { repo: p.repo, number: p.number },
        },
      };
    }
    if (p.user_is_reviewer) {
      return {
        type: 'review_pr',
        title: `Review PR #${p.number} — ${p.title}`,
        action: { kind: 'github_review', params: { repo: p.repo, number: p.number } },
      };
    }
  }

  // GitHub issue assigned
  if (signal.type === 'github_issue' && p.assignee_login && p.state === 'open') {
    return {
      type: 'todo',
      title: `Pick up issue #${p.number} — ${p.title}`,
      action: { kind: 'todo', params: { title: p.title, repo: p.repo, number: p.number } },
    };
  }

  // Email — meeting invite pattern
  if (signal.type === 'email' && /(rsvp|invit|meeting|join.*call|calendar)/.test(text)) {
    return {
      type: 'draft_reply',
      title: `Reply: ${p.subject || '(no subject)'}`,
      action: {
        kind: 'email_reply',
        params: {
          to: p.from,
          subject: p.subject ? `Re: ${p.subject}` : '',
          threadId: p.threadId,
        },
      },
    };
  }

  // Email — actionable thread from a known person
  if (signal.type === 'email' && p.from && !p.from.includes('noreply')) {
    if (/(please|could you|can you|need|asap|urgent|deadline|review)/.test(text)) {
      return {
        type: 'draft_reply',
        title: `Reply: ${p.subject || '(no subject)'}`,
        action: {
          kind: 'email_reply',
          params: { to: p.from, subject: p.subject ? `Re: ${p.subject}` : '', threadId: p.threadId },
        },
      };
    }
  }

  // Slack mention
  if (signal.type === 'slack_message' && p.mentions_me) {
    return {
      type: 'draft_reply',
      title: `Reply in #${p.channel || 'channel'}`,
      action: { kind: 'slack_reply', params: { channel: p.channel, ts: p.ts } },
    };
  }

  // Linear issue — review / scope_check
  if (signal.type === 'linear_issue' && p.identifier) {
    const labelNames = (p.labels || []).join(' ').toLowerCase();
    const text = `${p.title || ''} ${p.description || ''}`.toLowerCase();
    // Multiple issues sharing a label or repeated pain → requirement_synthesis
    if (
      /(upload|upload-large|churn|onboard|invit)/.test(labelNames) ||
      /(upload|churn|onboard|invite).*(fail|broken|loss|drop)/.test(text)
    ) {
      return {
        type: 'requirement_synthesis',
        title: `Synthesize requirement: ${p.title || p.identifier}`,
        action: {
          kind: 'requirement_synthesis',
          params: {
            draft_target: 'linear:new',
            title: `[REQ] ${p.title || p.identifier}`,
            body_template: 'PR/FAQ',
            evidence_count: 1,
            source_issue_id: p.identifier,
          },
        },
      };
    }
    return {
      type: 'linear_review',
      title: `Review ${p.identifier}: ${p.title || ''}`.trim(),
      action: {
        kind: 'linear_review',
        params: {
          issue_id: p.identifier,
          scope_check: true,
        },
      },
    };
  }

  // Obsidian note changed — map path prefix to typed decision
  if (signal.type === 'obsidian_note_changed' && p.path) {
    const path = p.path;
    const filename = (path.split('/').pop() || '').replace(/\.md$/i, '');
    const folder = (path.split('/').slice(0, -1).pop() || '').toLowerCase();

    if (folder === 'projects' || folder === 'plans') {
      return {
        type: 'release_plan',
        title: `Update release plan: ${path}`,
        action: {
          kind: 'release_plan',
          params: { source_path: path, mtime_ms: p.mtime_ms },
        },
      };
    }
    if (folder === 'people') {
      return {
        type: 'todo',
        title: `Update contact: ${path}`,
        action: {
          kind: 'contact_update',
          params: { source_path: path, mtime_ms: p.mtime_ms },
        },
      };
    }
    if (folder === 'customers') {
      return {
        type: 'requirement_synthesis',
        title: `Customer note changed — re-review requirements: ${path}`,
        action: {
          kind: 'requirement_synthesis',
          params: {
            draft_target: 'linear:new',
            source_path: path,
            evidence_count: 1,
          },
        },
      };
    }
    // ideas/, drafts/, or any other path → doc_update
    return {
      type: 'doc_update',
      title: `Regenerate document: ${path}`,
      action: {
        kind: 'doc_update',
        params: {
          target_path: path,
          source_path: path,
          mtime_ms: p.mtime_ms,
        },
      },
    };
  }

  return null;
}

const rules = {
  isHardSkipped,
  classify,
  NORELY_RE,
  PROMO_LABELS,
};

module.exports = {
  paths,
  api,
  agent,
  signals,
  decisions,
  rules,
  config: { read: readConfig, write: writeConfig, defaults: defaultConfig },
  utils: { now, uid, log, readJson, writeJsonAtomic, readJsonl, appendJsonl, cleanChildEnv },
  normalizeDecision,
};
