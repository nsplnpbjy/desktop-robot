'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const roleArgument = process.argv.find((argument) => argument.startsWith('--window-role='));
const role = roleArgument ? roleArgument.split('=')[1] : '';

function onEvent(callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on('app:event', listener);
  return () => ipcRenderer.removeListener('app:event', listener);
}

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

if (role === 'pet') {
  contextBridge.exposeInMainWorld('desktopRobot', {
    role,
    onEvent,
    getBootstrap: () => invoke('pet:get-bootstrap'),
    toggleChat: () => invoke('pet:toggle-chat'),
    showMenu: () => invoke('pet:context-menu'),
    dragStart: () => ipcRenderer.send('pet:drag-start'),
    dragEnd: () => ipcRenderer.send('pet:drag-end'),
  });
} else if (role === 'chat') {
  contextBridge.exposeInMainWorld('desktopRobot', {
    role,
    onEvent,
    getBootstrap: () => invoke('chat:get-bootstrap'),
    sendMessage: (text) => invoke('chat:send', text),
    resetChat: () => invoke('chat:reset'),
    closeChat: () => invoke('chat:close'),
    openSettings: () => invoke('chat:open-settings'),
    voiceReserved: () => invoke('chat:voice-reserved'),
    replyFinished: (turnId) => invoke('chat:reply-finished', turnId),
  });
} else if (role === 'settings') {
  contextBridge.exposeInMainWorld('desktopRobot', {
    role,
    onEvent,
    getConfig: () => invoke('settings:get'),
    saveConfig: (text) => invoke('settings:save', text),
    reloadConfig: () => invoke('settings:reload'),
    testConnection: () => invoke('settings:test'),
    openConfigFile: () => invoke('settings:open-file'),
    openConfigFolder: () => invoke('settings:open-folder'),
    openAnimationsFolder: () => invoke('settings:open-animations'),
    openLogFile: () => invoke('settings:open-log'),
  });
} else {
  // Never expose IPC to an unexpected window.
  contextBridge.exposeInMainWorld('desktopRobot', { role: 'unknown' });
}
