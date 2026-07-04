"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pet", {
  // 主进程 → 渲染层
  onState: (cb) => ipcRenderer.on("pet:state", (_e, data) => cb(data)),
  onBubble: (cb) => ipcRenderer.on("pet:bubble", (_e, data) => cb(data)),
  onConfig: (cb) => ipcRenderer.on("pet:config", (_e, data) => cb(data)),
  // 渲染层 → 主进程
  getConfig: () => ipcRenderer.invoke("get-config"),
  getWinPos: () => ipcRenderer.invoke("get-win-pos"),
  setWinPos: (x, y) => ipcRenderer.send("set-win-pos", x, y),
  setIgnoreMouse: (ignore) => ipcRenderer.send("set-ignore-mouse", ignore),
  launchOpenLoomi: () => ipcRenderer.send("launch-openloomi"),
  toggleMute: () => ipcRenderer.send("toggle-mute"),
  openLog: () => ipcRenderer.send("open-log"),
  quit: () => ipcRenderer.send("quit-app"),
  petLog: (tag, msg) =>
    ipcRenderer.send("pet-log", String(tag || ""), String(msg || "")),
});
