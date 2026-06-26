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
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
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
// Config
// ---------------------------------------------------------------------------

function defaultConfig() {
  return {
    intervalSec: 60,
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

function readDecisions() {
  ensureDirs();
  return readJson(DECISIONS_PATH, { pending: [], done: [], dismissed: [] });
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
  signals,
  decisions,
  rules,
  config: { read: readConfig, write: writeConfig, defaults: defaultConfig },
  utils: { now, uid, log, readJson, writeJsonAtomic, readJsonl, appendJsonl },
};
