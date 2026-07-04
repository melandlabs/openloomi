"use strict";

// OpenLoomi 活动观察器 —— 桌宠唯一的事件来源，全部盯**本机真实数据**：
//
//   ① 进程/端口存活：pgrep openloomi.app + GET http://127.0.0.1:3415/api/ai/chat
//      （OpenLoomi 桌面版本地 API，免鉴权）。在跑→醒着；没跑→睡觉；上线瞬间→greet。
//   ② 审计流：~/.openloomi/logs/audit.jsonl（{timestamp,type,detail} JSONL 增量 tail）
//      file_read / command_exec → working，按 detail 归类工具（技能/记忆/检索/连接器/任务）。
//   ③ 主日志：~/.openloomi/logs/openloomi.log（[ts] [LEVEL] [Module] 增量 tail）
//      [ERROR] → error 表情；ClaudeAgent 活动 → working(Agent)。
//   ④ 消息库：~/.openloomi/data/data.db（sqlite WAL，经系统 sqlite3 CLI 只读轮询）
//      新 user 消息 → thinking；新 assistant 消息 → talking + 把回复文本交给 brain。
//
// 状态模型：base（sleeping/idle/thinking/working） + 一次性 overlay（greet/talking/
// error/attention/happy/roam，带过期时间）。对外只暴露 effective 状态。
//
// OPENLOOMI_PET_DEMO=1 时改跑内置演示脚本（轮播所有表情，验收皮肤用）。

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { log } = require("./log");

const LOOMI_HOME =
  process.env.OPENLOOMI_HOME || path.join(os.homedir(), ".openloomi");
const AUDIT_LOG = path.join(LOOMI_HOME, "logs", "audit.jsonl");
const MAIN_LOG = path.join(LOOMI_HOME, "logs", "openloomi.log");
const DATA_DB = path.join(LOOMI_HOME, "data", "data.db");
// 本地服务端口随版本变过（0.5.x=3415，0.6.x=3414），全部探测，命中后记住。
const API_URLS = process.env.OPENLOOMI_API_URL
  ? [process.env.OPENLOOMI_API_URL]
  : ["http://127.0.0.1:3414", "http://127.0.0.1:3415"];

const PRESENCE_MS = 5000;
const TAIL_MS = 1500;
const DB_MS = 3000; // 消息要跟手，轮询给快
const TICK_MS = 1000;
const QUIET_TO_IDLE_MS = 30 * 1000; // 忙碌态静默回落（30s，别假忙）
const IDLE_TO_ROAM_MS = 10 * 60 * 1000; // 待命太久出去溜达
const ROAM_EVERY_MS = 4 * 60 * 1000;
const ROAM_LEN_MS = 12 * 1000;

const TOOLS = {
  Read: { icon: "📄", label: "读文件" },
  Exec: { icon: "🛠️", label: "执行命令" },
  Connector: { icon: "🔌", label: "同步连接器" },
  Memory: { icon: "🧠", label: "整理记忆" },
  Agent: { icon: "🤖", label: "agent 干活" },
  Skill: { icon: "✨", label: "读技能" },
  Search: { icon: "🔍", label: "检索上下文" },
};

// audit 行 → {tool, hint}。hint 是给状态条看的具体对象（文件名/命令），
// 只取短尾巴，绝不外传（hint 只进本地 UI，不进 brain 的 prompt）。
function classifyAudit(type, detail) {
  const d = String(detail || "");
  const dl = d.toLowerCase();
  const base = (d.split("/").pop() || "").slice(0, 24);
  if (type === "command_exec")
    return { tool: "Exec", hint: d.trim().slice(0, 24) };
  if (dl.includes("/skills/") || dl.endsWith("skill.md"))
    return { tool: "Skill", hint: base };
  if (dl.includes("memory")) return { tool: "Memory", hint: base };
  if (dl.includes("/rag/") || dl.includes("document"))
    return { tool: "Search", hint: base };
  if (dl.includes("integration") || dl.includes("connector"))
    return { tool: "Connector", hint: base };
  return { tool: "Read", hint: base };
}

function stripText(s, max = 400) {
  const t = String(s || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function createWatcher(handlers) {
  const onState = handlers.onState || (() => {}); // ({state, tool, icon, label})
  const onMoment = handlers.onMoment || (() => {}); // 给 brain 的"值得说话的时刻"

  let stopped = false;
  const timers = [];

  let base = "sleeping";
  let baseTool = null;
  let baseHint = null;
  let overlay = null; // {state, until, tool}
  let lastEffective = null;

  let online = null;
  let lastActivity = 0;
  let lastChatTs = 0; // 最近一次聊天消息（区分"聊天干活"和"后台家务"）
  let turnUntil = 0; // 回合窗口：用户提问后、回复到达前（上限 10 分钟）
  let lastToolTs = 0; // 最近一次工具活动；回合内工具间隙回落 thinking
  let idleSince = 0;
  let lastRoam = 0;
  let auditPos = -1;
  let mainPos = -1;
  let dbLastRowid = -1;
  let dbBroken = false;

  const TURN_MAX_MS = 10 * 60 * 1000;
  const TOOL_GAP_TO_THINKING_MS = 8 * 1000;

  function turnActive() {
    return Date.now() < turnUntil;
  }

  // ── 状态输出 ───────────────────────────────────────────────────────────────
  function effective() {
    const now = Date.now();
    if (overlay && overlay.until > now)
      return { state: overlay.state, tool: overlay.tool || null, hint: null };
    return { state: base, tool: baseTool, hint: baseHint };
  }

  function publish() {
    const e = effective();
    const key = e.state + ":" + (e.tool || "") + ":" + (e.hint || "");
    if (key === lastEffective) return;
    lastEffective = key;
    const t = e.tool && TOOLS[e.tool] ? TOOLS[e.tool] : null;
    onState({
      state: e.state,
      tool: e.tool,
      icon: t ? t.icon : null,
      label: t ? t.label : null,
      hint: e.hint,
    });
  }

  function setBase(state, tool = null, hint = null) {
    base = state;
    baseTool = tool;
    baseHint = hint;
    if (state === "idle") {
      if (!idleSince) idleSince = Date.now();
    } else idleSince = 0;
    publish();
  }

  function flash(state, ms, tool = null) {
    overlay = { state, until: Date.now() + ms, tool };
    publish();
  }

  function markActive() {
    lastActivity = Date.now();
  }

  // ── ① 进程/端口存活 ───────────────────────────────────────────────────────
  function probeProcess(cb) {
    if (process.platform === "win32") return cb(false);
    execFile(
      "pgrep",
      ["-f", "openloomi.app/Contents/MacOS|openloomi-desktop"],
      (err, out) => {
        cb(!err && String(out).trim().length > 0);
      },
    );
  }

  let apiHit = null; // 上次探通的 base URL，优先复用
  function probeOne(base, cb) {
    // 只要端口上有 HTTP 服务在应答（无论状态码）就算在线
    const req = http.get(base + "/", { timeout: 1500 }, (res) => {
      res.resume();
      cb(true);
    });
    req.on("error", () => cb(false));
    req.on("timeout", () => {
      req.destroy();
      cb(false);
    });
  }
  function probeApi(cb) {
    const order = apiHit
      ? [apiHit, ...API_URLS.filter((u) => u !== apiHit)]
      : API_URLS;
    let i = 0;
    const next = () => {
      if (i >= order.length) {
        apiHit = null;
        return cb(false);
      }
      const base = order[i++];
      probeOne(base, (ok) => {
        if (ok) {
          apiHit = base;
          return cb(true);
        }
        next();
      });
    };
    next();
  }

  function presenceTick() {
    if (stopped) return;
    probeProcess((procUp) => {
      if (procUp) return applyPresence(true);
      probeApi(applyPresence);
    });
  }

  function applyPresence(up) {
    if (stopped) return;
    const was = online;
    online = up;
    if (up && was !== true) {
      log("watcher", "OpenLoomi online");
      setBase("idle");
      flash("greet", 3500);
      markActive();
      if (was === false) onMoment({ kind: "online" });
    } else if (!up && was !== false) {
      log("watcher", "OpenLoomi offline → sleeping");
      overlay = null;
      setBase("sleeping");
    }
  }

  // ── 增量 tail ─────────────────────────────────────────────────────────────
  function readDelta(file, pos, cb) {
    fs.stat(file, (err, st) => {
      if (err) return cb(pos, []);
      if (pos < 0 || pos > st.size) return cb(st.size, []);
      if (st.size === pos) return cb(pos, []);
      const stream = fs.createReadStream(file, {
        start: pos,
        end: st.size - 1,
        encoding: "utf8",
      });
      let buf = "";
      stream.on("data", (c) => {
        buf += c;
      });
      stream.on("error", () => cb(pos, []));
      stream.on("end", () => {
        const nl = buf.lastIndexOf("\n");
        if (nl < 0) return cb(pos, []);
        cb(
          pos + Buffer.byteLength(buf.slice(0, nl + 1), "utf8"),
          buf.slice(0, nl).split("\n"),
        );
      });
    });
  }

  // ── ② 审计流 → working ────────────────────────────────────────────────────
  function auditTick() {
    if (stopped) return;
    readDelta(AUDIT_LOG, auditPos, (pos, lines) => {
      auditPos = pos;
      if (!lines.length) return;
      const tally = {};
      const hints = {};
      for (const line of lines.slice(0, 2000)) {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        const { tool, hint } = classifyAudit(ev.type, ev.detail);
        tally[tool] = (tally[tool] || 0) + 1;
        if (hint) hints[tool] = hint; // 留每类最后一个对象名给状态条
      }
      const top = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
      if (top) {
        setBase("working", top, hints[top] || null);
        lastToolTs = Date.now();
        markActive();
        // 聊天进行中不为"干活"单独发台词——回复台词马上就来，别抢戏；
        // 只有纯后台家务（近 2 分钟没聊天）才值得汇报一句。
        if (Date.now() - lastChatTs > 2 * 60 * 1000) {
          onMoment({ kind: "working", tool: top, count: lines.length });
        }
      }
    });
  }

  // ── ③ 主日志 → error / agent 活动 / 等你出手（permission） ─────────────────
  // permission 行样例（lib/ai/extensions/agent/claude/permissions.ts）：
  //   [Claude <sid>] Permission request: <toolName>
  //   [Claude <sid>] Permission decision: allow|deny
  const MAIN_RE = /^\[[^\]]+\] \[([A-Z]+)\] \[([^\]]*)\]\s*(.*)$/;
  const PERM_REQ_RE = /Permission request[^:]*:\s*(\S+)/;
  const PERM_DEC_RE = /Permission decision[^:]*:\s*(allow|deny)/;
  let permHold = null; // {tool, since} 等待用户批准/回复中
  let recentErrors = []; // 近 5 分钟错误时间戳（连续出错 → angry）

  function mainLogTick() {
    if (stopped) return;
    readDelta(MAIN_LOG, mainPos, (pos, lines) => {
      mainPos = pos;
      let errLine = null;
      let sawAgent = false;
      for (const line of lines) {
        const m = MAIN_RE.exec(line);
        if (!m) continue;
        const msg = m[3] || "";
        const req = PERM_REQ_RE.exec(msg);
        const dec = PERM_DEC_RE.exec(msg);
        if (req) {
          const tool = req[1];
          permHold = { tool, since: Date.now() };
          // 提问/选择类 → needsinput；其余工具授权 → waiting
          const state = /AskUserQuestion|ExitPlanMode/i.test(tool)
            ? "needsinput"
            : "waiting";
          overlay = { state, until: Date.now() + 10 * 60 * 1000, tool: null };
          publish();
          markActive();
          onMoment({ kind: "waiting", tool });
        } else if (dec) {
          if (permHold) {
            permHold = null;
            overlay = null;
            setBase("working", "Agent");
            markActive();
          }
        } else if (m[1] === "ERROR") {
          errLine = stripText(msg, 160);
        } else if (m[2] === "ClaudeAgent") {
          sawAgent = true;
        }
      }
      if (errLine) {
        // 出错也解除等待和回合（会话已经翻车了，别一直举着手/装思考）
        permHold = null;
        turnUntil = 0;
        if (
          overlay &&
          (overlay.state === "waiting" || overlay.state === "needsinput")
        )
          overlay = null;
        // 5 分钟内第二次出错 → 从"大哭"升级成"生气冒烟"
        const now2 = Date.now();
        recentErrors = recentErrors.filter((t) => now2 - t < 5 * 60 * 1000);
        recentErrors.push(now2);
        flash(recentErrors.length >= 2 ? "angry" : "error", 8000);
        markActive();
        onMoment({ kind: "error", detail: errLine });
      } else if (sawAgent && !permHold && !turnActive()) {
        // 回合内不让 runtime 杂音（同步技能等日志行）打断 thinking——
        // 回合内只有真实工具活动（audit）才切 working。
        setBase("working", "Agent");
        markActive();
      }
    });
  }

  // ── ④ 消息库 → thinking / talking ─────────────────────────────────────────
  function extractText(partsJson) {
    try {
      for (const p of JSON.parse(partsJson)) {
        if (p && p.type === "text" && p.text) return stripText(p.text);
      }
    } catch {}
    return "";
  }

  function dbTick() {
    if (stopped || dbBroken || !fs.existsSync(DATA_DB)) return;
    const sql =
      "SELECT rowid, role, parts FROM Message_v2 ORDER BY rowid DESC LIMIT 8;";
    execFile(
      "sqlite3",
      ["-readonly", "-json", DATA_DB, sql],
      { timeout: 4000 },
      (err, out) => {
        if (stopped) return;
        if (err) {
          dbBroken = true;
          log(
            "watcher",
            "db poll disabled:",
            String(err.message).slice(0, 120),
          );
          return;
        }
        let rows;
        try {
          rows = JSON.parse(out || "[]");
        } catch {
          return;
        }
        if (!rows.length) return;
        const maxRowid = rows[0].rowid;
        if (dbLastRowid < 0) {
          dbLastRowid = maxRowid;
          return;
        } // 首查不回放历史
        if (maxRowid <= dbLastRowid) return;
        const fresh = rows.filter((r) => r.rowid > dbLastRowid); // 新→旧
        dbLastRowid = maxRowid;
        lastChatTs = Date.now();
        // 只按"最新一条"定状态，别把已过时的中间态回放出来
        // （轮询间隔内 user+assistant 一起到时，直接演最终幕）。
        const latest = fresh[0];
        if (latest.role === "user") {
          turnUntil = Date.now() + TURN_MAX_MS; // 开回合：思考态可持续，工具间隙会回落回来
          setBase("thinking");
          markActive();
        } else if (latest.role === "assistant") {
          turnUntil = 0; // 收回合
          const text = extractText(latest.parts);
          setBase("idle");
          flash("talking", 6000);
          // 说完话竖个大拇指：回合圆满收工
          timers.push(
            setTimeout(() => {
              if (!stopped) flash("done", 3500);
            }, 6100),
          );
          markActive();
          if (text) onMoment({ kind: "reply", text });
        }
      },
    );
  }

  // ── 心跳：overlay 过期、静默回落、闲极溜达 ─────────────────────────────────
  function tick() {
    if (stopped) return;
    const now = Date.now();
    if (overlay && overlay.until <= now) {
      overlay = null;
      publish();
    }
    if (online) {
      if (turnActive()) {
        // 回合内：一旦动过工具就保持"拿电脑干活"直到回复（用户直觉：整个
        // 任务过程=工作中）。工具间隙只把具体动作（读文件 xx）过期掉，
        // 状态条退成"干活中…"。thinking 只属于提问后、第一次动工前。
        if (
          base === "working" &&
          (baseTool || baseHint) &&
          lastToolTs &&
          now - lastToolTs > TOOL_GAP_TO_THINKING_MS
        ) {
          setBase("working", null, null);
        }
      } else if (
        (base === "working" || base === "thinking") &&
        lastActivity &&
        now - lastActivity > QUIET_TO_IDLE_MS
      ) {
        setBase("idle");
      }
      if (
        base === "idle" &&
        idleSince &&
        now - idleSince > IDLE_TO_ROAM_MS &&
        now - lastRoam > ROAM_EVERY_MS
      ) {
        lastRoam = now;
        flash("roam", ROAM_LEN_MS);
      }
    }
    publish();
  }

  // ── 演示模式：轮播所有表情（皮肤验收用） ───────────────────────────────────
  const DEMO = [
    ["greet", 3000],
    ["idle", 3000],
    ["thinking", 3000],
    ["working", 3000, "Connector"],
    ["working", 3000, "Memory"],
    ["juggling", 3000, "Agent"],
    ["talking", 3000],
    ["happy", 3000],
    ["sweeping", 3000, "Memory"],
    ["waiting", 3000],
    ["needsinput", 3000],
    ["attention", 3000],
    ["done", 3000],
    ["loved", 3000],
    ["roam", 3000],
    ["error", 3000],
    ["angry", 3000],
    ["sleeping", 4000],
  ];
  let demoIdx = 0;
  function demoTick() {
    if (stopped) return;
    const [st, ms, tool] = DEMO[demoIdx % DEMO.length];
    demoIdx++;
    const t = tool && TOOLS[tool] ? TOOLS[tool] : null;
    onState({
      state: st,
      tool: tool || null,
      icon: t ? t.icon : null,
      label: t ? t.label : null,
    });
    if (st === "talking")
      onMoment({
        kind: "reply",
        text: "（演示）我刚把 3 封邮件和 2 条 issue 织进了记忆图谱。",
      });
    timers.push(setTimeout(demoTick, ms));
  }

  function every(fn, ms) {
    const t = setInterval(fn, ms);
    if (t.unref) t.unref();
    timers.push(t);
  }

  function start() {
    if (process.env.OPENLOOMI_PET_DEMO === "1") {
      log("watcher", "DEMO mode（表情轮播）");
      timers.push(setTimeout(demoTick, 1000));
      return;
    }
    log(
      "watcher",
      `watching OpenLoomi: api=${API_URLS.join(",")} home=${LOOMI_HOME}`,
    );
    presenceTick();
    every(presenceTick, PRESENCE_MS);
    every(auditTick, TAIL_MS);
    every(mainLogTick, TAIL_MS);
    every(dbTick, DB_MS);
    every(tick, TICK_MS);
  }

  function stop() {
    stopped = true;
    for (const t of timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    timers.length = 0;
  }

  return { start, stop, TOOLS };
}

module.exports = { createWatcher };
