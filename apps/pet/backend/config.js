'use strict';

// 配置持久化：~/.openloomipet/config.json（原子写）。
// 字段：deepseekApiKey / petPosition {x,y} / muted / bubbleEveryMs
// key 也可用环境变量 DEEPSEEK_API_KEY 覆盖（优先）。

const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = path.join(os.homedir(), '.openloomipet');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  deepseekApiKey: '',
  petPosition: null,
  muted: false,
  bubbleEveryMs: 90 * 1000, // DeepSeek 台词最短间隔
};

let cache = null;

function get() {
  if (cache) return cache;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  cache = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  return cache;
}

function save(patch) {
  const next = { ...get(), ...patch };
  cache = next;
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const tmp = path.join(CONFIG_DIR, `.config.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_PATH);
  } catch {}
  return next;
}

function apiKey() {
  return process.env.DEEPSEEK_API_KEY || get().deepseekApiKey || '';
}

module.exports = { get, save, apiKey, CONFIG_PATH };
