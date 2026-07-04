"use strict";

// 桌宠渲染层：状态贴图 + 气泡 + 拖动 + 右键菜单。
// 数据只来自 preload 暴露的 window.pet（pet:state / pet:bubble / pet:config）。

const loomi = document.getElementById("loomi");
const img = document.getElementById("loomi-img");
const bubble = document.getElementById("bubble");
const prop = document.getElementById("prop");
const statusChip = document.getElementById("status-chip");
const menu = document.getElementById("menu");

const STATES = [
  "idle",
  "roam",
  "working",
  "thinking",
  "talking",
  "juggling",
  "sweeping",
  "waiting",
  "needsinput",
  "happy",
  "greet",
  "attention",
  "sleeping",
  "error",
  "done",
  "angry",
  "loved",
];

let muted = false;
let bubbleTimer = null;
let lastStateData = null; // 摸头互动结束后恢复用
let lovedActive = false;

// ---------- 状态 ----------
function setState(s) {
  lastStateData = s;
  if (lovedActive) return; // 摸头动画期间先记下，结束时恢复
  const state = STATES.includes(s.state) ? s.state : "idle";
  loomi.classList.remove(...STATES);
  loomi.classList.add(state);
  const file = `../assets/loomi/loomi-${state}.png`;
  if (!img.src.endsWith(`loomi-${state}.png`)) img.src = file;

  if (
    s.icon &&
    (state === "working" || state === "juggling" || state === "sweeping")
  ) {
    prop.textContent = s.icon;
    prop.classList.add("on");
    prop.title = s.label || "";
  } else {
    prop.classList.remove("on");
  }
  updateStatusChip(state, s);
  if (state === "sleeping") hideBubble();
  window.pet.petLog(
    "state",
    state + (s.tool ? ":" + s.tool : "") + (s.hint ? "·" + s.hint : ""),
  );
}

// ---------- 脚下状态条 ----------
// 干活时显示"图标 动作 · 对象名"；思考/等待也给一句，让状态肉眼可读。
function updateStatusChip(state, s) {
  let text = "";
  if (
    (state === "working" || state === "juggling" || state === "sweeping") &&
    s.label
  ) {
    text = `${s.icon || ""} ${s.label}${s.hint ? " · " + s.hint : ""}`.trim();
  } else if (state === "working") {
    text = "💻 干活中…"; // 工具间隙：保持工作姿势，动作条退成泛化文案
  } else if (state === "thinking") {
    text = "💭 思考中…";
  } else if (state === "waiting") {
    text = "✋ 等你批准";
  } else if (state === "needsinput") {
    text = "❓ 等你回复";
  } else if (state === "done") {
    text = "✅ 搞定！";
  } else if (state === "angry") {
    text = "💢 老是出错，气！";
  } else if (state === "loved") {
    text = "🥰 好开心～";
  }
  if (text) {
    statusChip.textContent = text;
    statusChip.classList.remove("hidden");
  } else {
    statusChip.classList.add("hidden");
  }
}

// ---------- 气泡 ----------
// 读得完为先：停留时间按字数给足（10s 起步），连续台词排队不互抢，
// 鼠标悬停时暂停倒计时，点一下手动关掉（关掉后立即放下一条）。
const bubbleQueue = [];
let bubbleHovered = false;

function bubbleDuration(text) {
  return Math.min(45000, Math.max(10000, text.length * 320));
}

function showBubble(text) {
  if (muted || !text) return;
  if (!bubble.classList.contains("hidden")) {
    bubbleQueue.push(text);
    if (bubbleQueue.length > 3) bubbleQueue.shift(); // 最多攒 3 条，太旧的丢掉
    return;
  }
  bubble.textContent = text;
  bubble.classList.remove("hidden");
  armBubbleTimer(bubbleDuration(text));
}

function armBubbleTimer(ms) {
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    if (bubbleHovered) {
      armBubbleTimer(3000);
      return;
    } // 正在看：续命再查
    hideBubble();
  }, ms);
}

function hideBubble() {
  bubble.classList.add("hidden");
  if (bubbleTimer) {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }
  const next = bubbleQueue.shift();
  if (next) setTimeout(() => showBubble(next), 400);
}

bubble.addEventListener("click", hideBubble);
bubble.addEventListener("mouseenter", () => {
  bubbleHovered = true;
});
bubble.addEventListener("mouseleave", () => {
  bubbleHovered = false;
});

// ---------- 拖动（移动窗口）/ 点击 ----------
let drag = null;
loomi.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  try {
    loomi.setPointerCapture(e.pointerId);
  } catch {}
  drag = { sx: e.screenX, sy: e.screenY, win: null, moved: false };
  window.pet.getWinPos().then(([x, y]) => {
    if (drag) drag.win = [x, y];
  });
});
loomi.addEventListener("pointermove", (e) => {
  if (!drag || !drag.win) return;
  const dx = e.screenX - drag.sx;
  const dy = e.screenY - drag.sy;
  if (Math.abs(dx) + Math.abs(dy) > 4) {
    drag.moved = true;
    loomi.classList.add("dragging");
    window.pet.setWinPos(drag.win[0] + dx, drag.win[1] + dy);
  }
});
loomi.addEventListener("pointerup", (e) => {
  const wasDrag = drag && drag.moved;
  loomi.classList.remove("dragging");
  drag = null;
  if (!wasDrag && e.button === 0) {
    // 单击：有气泡先收起，否则唤起 OpenLoomi
    if (!bubble.classList.contains("hidden")) hideBubble();
    else window.pet.launchOpenLoomi();
  }
});

// ---------- 摸头互动 ----------
// 鼠标停在小狐狸身上 1.5s = 摸头 → 爱心眼 3s（10s 冷却，拖动中不触发）
let petHoverTimer = null;
let lovedCooldownUntil = 0;

function triggerLoved() {
  if (lovedActive || drag || Date.now() < lovedCooldownUntil) return;
  lovedActive = true;
  lovedCooldownUntil = Date.now() + 10000;
  loomi.classList.remove(...STATES);
  loomi.classList.add("loved");
  img.src = "../assets/loomi/loomi-loved.png";
  statusChip.textContent = "🥰 好开心～";
  statusChip.classList.remove("hidden");
  window.pet.petLog("state", "loved(petting)");
  setTimeout(() => {
    lovedActive = false;
    if (lastStateData) setState(lastStateData);
  }, 3000);
}

loomi.addEventListener("mouseenter", () => {
  if (petHoverTimer) clearTimeout(petHoverTimer);
  petHoverTimer = setTimeout(triggerLoved, 1500);
});
loomi.addEventListener("mouseleave", () => {
  if (petHoverTimer) {
    clearTimeout(petHoverTimer);
    petHoverTimer = null;
  }
});

// ---------- 右键菜单 ----------
loomi.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  menu.classList.toggle("hidden");
});
menu.addEventListener("click", (e) => {
  const op = e.target && e.target.dataset && e.target.dataset.op;
  if (!op) return;
  menu.classList.add("hidden");
  if (op === "launch") window.pet.launchOpenLoomi();
  else if (op === "mute") window.pet.toggleMute();
  else if (op === "log") window.pet.openLog();
  else if (op === "quit") window.pet.quit();
});
document.addEventListener("click", (e) => {
  if (
    !menu.classList.contains("hidden") &&
    !menu.contains(e.target) &&
    e.target !== loomi
  ) {
    menu.classList.add("hidden");
  }
});

// ---------- 空白处鼠标穿透 ----------
// 窗口是透明矩形，只有落在 Loomi/气泡/菜单上的鼠标事件才归我们。
document.addEventListener("mousemove", (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const mine =
    el &&
    (loomi.contains(el) ||
      el === loomi ||
      bubble.contains(el) ||
      el === bubble ||
      menu.contains(el) ||
      el === menu);
  window.pet.setIgnoreMouse(!mine);
});

// ---------- 接线 ----------
window.pet.onState(setState);
window.pet.onBubble((b) => showBubble(b && b.text));
window.pet.onConfig((c) => {
  muted = !!(c && c.muted);
  const muteBtn = menu.querySelector('[data-op="mute"]');
  if (muteBtn)
    muteBtn.textContent = muted ? "🔔 打开台词气泡" : "🔇 关闭台词气泡";
  if (muted) hideBubble();
});
window.pet.getConfig().then((c) => {
  muted = !!(c && c.muted);
});
