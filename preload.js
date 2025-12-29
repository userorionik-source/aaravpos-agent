// preload.js
const { contextBridge } = require('electron');

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('aaravpos', {
  platform: process.platform,
  version: require('./package.json').version
});