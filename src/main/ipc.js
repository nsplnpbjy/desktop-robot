'use strict';

const { ipcMain, shell } = require('electron');

function registerIpc({
  windows,
  chatService,
  runtime,
  actions,
  logger,
}) {
  const assertRole = (event, role) => {
    if (windows.roleForWebContents(event.sender.id) !== role) {
      throw new Error(`Unauthorized IPC sender for ${role}`);
    }
  };

  const handle = (channel, role, handler) => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertRole(event, role);
      try {
        return await handler(...args);
      } catch (error) {
        logger.error('IPC handler failed', {
          channel,
          message: error.message,
        });
        throw error;
      }
    });
  };

  const receive = (channel, role, handler) => {
    ipcMain.on(channel, (event, ...args) => {
      try {
        assertRole(event, role);
        handler(...args);
      } catch (error) {
        logger.warn('Rejected IPC message', {
          channel,
          message: error.message,
        });
      }
    });
  };

  handle('pet:get-bootstrap', 'pet', () => ({
    config: runtime.publicConfig(),
    chatVisible: windows.isChatVisible(),
    platform: process.platform,
  }));

  handle('pet:toggle-chat', 'pet', () => {
    windows.toggleChat();
    return { ok: true, visible: windows.isChatVisible() };
  });

  handle('pet:context-menu', 'pet', () => {
    actions.showPetMenu();
    return { ok: true };
  });

  receive('pet:drag-start', 'pet', () => {
    windows.startPetDrag();
  });

  receive('pet:drag-end', 'pet', () => {
    windows.stopPetDrag();
  });

  handle('chat:get-bootstrap', 'chat', () => ({
    config: runtime.publicConfig(),
    messages: chatService.messages(),
    platform: process.platform,
  }));

  handle('chat:send', 'chat', (text) => chatService.sendMessage(text));

  handle('chat:reset', 'chat', () => chatService.resetConversation());

  handle('chat:close', 'chat', () => {
    windows.hideChat();
    return { ok: true };
  });

  handle('chat:open-settings', 'chat', () => {
    windows.openSettings();
    return { ok: true };
  });

  handle('chat:voice-reserved', 'chat', () => chatService.showVoiceReserved());

  handle('chat:reply-finished', 'chat', (turnId) => chatService.notifyReplyFinished(turnId));

  handle('settings:get', 'settings', async () => runtime.getSettingsData());

  handle('settings:save', 'settings', async (text) => runtime.saveConfigText(text));

  handle('settings:reload', 'settings', async () => runtime.reloadFromDisk());

  handle('settings:test', 'settings', async () => chatService.testConnection());

  handle('settings:open-file', 'settings', async () => actions.openConfigFile());

  handle('settings:open-folder', 'settings', async () => {
    shell.showItemInFolder(runtime.configPath());
    return { ok: true };
  });

  handle('settings:open-animations', 'settings', async () => actions.openAnimationsFolder());

  handle('settings:open-log', 'settings', async () => actions.openLogFile());
}

module.exports = {
  registerIpc,
};
