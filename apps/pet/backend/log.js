'use strict';

// 极简滚动日志：~/.openloomipet/openloomipet.log（超 2MB 滚一份 .1）。

const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG_DIR = path.join(os.homedir(), '.openloomipet');
const LOG_PATH = path.join(LOG_DIR, 'openloomipet.log');
const MAX_BYTES = 2 * 1024 * 1024;

let stream = null;

function open() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    try {
      if (fs.statSync(LOG_PATH).size > MAX_BYTES) fs.renameSync(LOG_PATH, LOG_PATH + '.1');
    } catch {}
    stream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
  } catch {
    stream = null;
  }
}

function log(tag, ...args) {
  if (!stream) open();
  if (!stream) return;
  const line = `${new Date().toISOString()} [${tag}] ${args.map(String).join(' ')}\n`;
  try { stream.write(line); } catch {}
}

module.exports = { log, LOG_PATH };
