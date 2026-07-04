"use strict";

// 桌宠的嘴 —— 用 DeepSeek 把"OpenLoomi 正在发生的事"变成一句台词气泡。
//
// 触发（由 watcher 的 onMoment 喂进来）：
//   reply    OpenLoomi 给用户回了话 → 转述/总结成一句
//   online   刚上线 → 打个招呼
//   error    出错 → 报告一声
//   working  持续干活 → 偶尔汇报在忙什么
//
// 约束：最短间隔 bubbleEveryMs（默认 90s，reply/error 例外可插队），
// 失败/没配 key 时用内置兜底台词，绝不阻塞主流程。

const https = require("https");
const config = require("./config");
const { log } = require("./log");

const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const API_HOST = "api.deepseek.com";
const TIMEOUT_MS = 30000;

const PERSONA =
  "你是 Loomi，一只白色小狐狸桌宠，是 AI 伙伴应用 OpenLoomi 的官方形象。" +
  "你趴在用户桌面上，替正在后台干活的 OpenLoomi 向用户说话。" +
  "规则：只输出一句话台词本身，不带引号不带前缀；中文；不超过 40 个字；" +
  "语气活泼但有信息量，像小动物在汇报；不要编造具体数字或没给你的事实。";

const FALLBACK = {
  online: ["我上线啦，有事随时叫我～", "Loomi 就位，今天也一起加油！"],
  reply: ["刚回了你一条消息，去看看嘛～", "你的消息我处理好啦！"],
  error: ["呜，刚才出了点小差错…", "有个任务翻车了，我看看怎么回事。"],
  working: ["我在后台忙着呢，别担心～", "正在整理你的信息流…"],
  waiting: ["有个操作在等你点头，快去看看～", "我举着爪子等你批准呢！"],
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function momentPrompt(m) {
  switch (m.kind) {
    case "reply":
      return `OpenLoomi 刚刚回复了用户，内容是：「${m.text}」。请把它浓缩/转述成你的一句台词，提醒用户去看。`;
    case "online":
      return "你（OpenLoomi）刚刚启动上线。跟用户打个招呼。";
    case "error":
      return `OpenLoomi 后台刚出了个错：「${m.detail || "未知错误"}」。用一句话向用户报告，语气委屈一点。`;
    case "working":
      return `你正在后台忙碌（大类：${m.tool || "杂务"}）。用一句话表达"我在后台干活呢"的状态。注意：你只知道大类，不知道具体内容，严禁编造具体任务名、文件名或细节。`;
    case "waiting":
      return `你（OpenLoomi 的 agent）想执行「${m.tool || "一个操作"}」，正在等用户批准或回复。用一句话催用户去看一眼，语气乖巧。`;
    default:
      return null;
  }
}

function callDeepSeek(userPrompt, cb) {
  const key = config.apiKey();
  if (!key) return cb(new Error("no api key"));
  const payload = JSON.stringify({
    model: MODEL,
    messages: [
      { role: "system", content: PERSONA },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 80,
    temperature: 1.1,
  });
  const req = https.request(
    {
      hostname: API_HOST,
      path: "/chat/completions",
      method: "POST",
      timeout: TIMEOUT_MS,
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    },
    (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => {
        try {
          const j = JSON.parse(body);
          const text =
            j.choices &&
            j.choices[0] &&
            j.choices[0].message &&
            j.choices[0].message.content;
          if (res.statusCode === 200 && text) cb(null, String(text).trim());
          else
            cb(
              new Error(
                `http ${res.statusCode}: ${String(body).slice(0, 120)}`,
              ),
            );
        } catch (e) {
          cb(e);
        }
      });
    },
  );
  req.on("error", cb);
  req.on("timeout", () => {
    req.destroy(new Error("timeout"));
  });
  req.end(payload);
}

function createBrain(onBubble) {
  let lastBubbleAt = 0;
  let inflight = false;

  function say(moment) {
    const now = Date.now();
    const minGap = config.get().bubbleEveryMs || 90000;
    const urgent = ["reply", "error", "online", "waiting"].includes(
      moment.kind,
    );
    if (!urgent && now - lastBubbleAt < minGap) return;
    if (urgent && now - lastBubbleAt < 8000) return; // 插队也别连珠炮
    if (inflight) return;

    const prompt = momentPrompt(moment);
    if (!prompt) return;
    inflight = true;
    lastBubbleAt = now;
    callDeepSeek(prompt, (err, text) => {
      inflight = false;
      if (err) {
        log("brain", "deepseek failed:", err.message);
        const fb = FALLBACK[moment.kind];
        if (fb) onBubble(pick(fb));
        return;
      }
      const line = text.replace(/^["'「『]+|["'」』]+$/g, "").slice(0, 80);
      log("brain", `[${moment.kind}] ${line}`);
      onBubble(line);
    });
  }

  return { say };
}

module.exports = { createBrain };
