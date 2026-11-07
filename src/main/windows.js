'use strict';

const path = require('node:path');
const { BrowserWindow, dialog, Menu, screen } = require('electron');

const { readWindowState, writeWindowState } = require('./window-state');

const ALLOWED_PET_STATES = new Set(['idle', 'thinking', 'talking', 'happy', 'error', 'listening']);

function isUsableBounds(saved, displays) {
  if (!saved) return false;
  return displays.some((display) => {
    const work = display.workArea;
    const visibleWidth = Math.min(saved.x + 380, work.x + work.width) - Math.max(saved.x, work.x);
    const visibleHeight = Math.min(saved.y + 220, work.y + work.height) - Math.max(saved.y, work.y);
    return visibleWidth >= 80 && visibleHeight >= 80;
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

class WindowManager {
  constructor({
    app,
    preloadPath,
    rendererDir,
    assetIconPath,
    userDataPath,
    getConfig,
    getPublicConfig,
    logger,
    onUiStateChanged = () => {},
  }) {
    this.app = app;
    this.preloadPath = preloadPath;
    this.rendererDir = rendererDir;
    this.assetIconPath = assetIconPath;
    this.userDataPath = userDataPath;
    this.getConfig = getConfig;
    this.getPublicConfig = getPublicConfig;
    this.logger = logger;
    this.onUiStateChanged = onUiStateChanged;

    this.config = getConfig();
    this.petWindow = null;
    this.chatWindow = null;
    this.settingsWindow = null;
    this.petStateTimer = null;
    this.dragInterval = null;
    this.dragSafety = null;
    this.dragSession = null;
    this.petHidden = false;
    this.quitting = false;
    this.windowStatePath = path.join(userDataPath, 'window-state.json');
    this.windowState = readWindowState(this.windowStatePath);
    this.displayListener = null;
  }

  roleForWebContents(id) {
    if (this.petWindow && !this.petWindow.isDestroyed() && this.petWindow.webContents.id === id) {
      return 'pet';
    }
    if (this.chatWindow && !this.chatWindow.isDestroyed() && this.chatWindow.webContents.id === id) {
      return 'chat';
    }
    if (this.settingsWindow && !this.settingsWindow.isDestroyed() && this.settingsWindow.webContents.id === id) {
      return 'settings';
    }
    return null;
  }

  windowForRole(role) {
    if (role === 'pet') return this.petWindow;
    if (role === 'chat') return this.chatWindow;
    if (role === 'settings') return this.settingsWindow;
    return null;
  }

  webPreferencesFor(role) {
    return {
      preload: this.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: role !== 'pet',
      additionalArguments: [`--window-role=${role}`],
    };
  }

  secureWebContents(window) {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('render-process-gone', (_event, details) => {
      this.logger.error('Renderer process exited', {
        role: this.roleForWebContents(window.webContents.id),
        reason: details.reason,
        exitCode: details.exitCode,
      });
    });
  }

  applyWindowFlags(window) {
    const config = this.getConfig();
    if (!window || window.isDestroyed()) return;
    window.setAlwaysOnTop(config.window.alwaysOnTop, 'floating');
    if (window !== this.settingsWindow) {
      window.setSkipTaskbar(!config.window.showInTaskbar);
    }
  }

  attachDisplayListener() {
    if (this.displayListener) return;
    this.displayListener = () => {
      if (this.petWindow && !this.petWindow.isDestroyed()) {
        const bounds = this.petWindow.getBounds();
        const display = screen.getDisplayMatching(bounds);
        const work = display.workArea;
        const x = clamp(bounds.x, work.x, Math.max(work.x, work.x + work.width - bounds.width));
        const y = clamp(bounds.y, work.y, Math.max(work.y, work.y + work.height - bounds.height));
        if (x !== bounds.x || y !== bounds.y) this.petWindow.setPosition(x, y);
        this.positionChatWindow();
      }
    };
    screen.on('display-metrics-changed', this.displayListener);
    screen.on('display-added', this.displayListener);
    screen.on('display-removed', this.displayListener);
  }

  resolvePetPosition(width, height) {
    const config = this.getConfig();
    const displays = screen.getAllDisplays();
    if (config.window.rememberPosition && isUsableBounds(this.windowState?.pet, displays)) {
      return { x: this.windowState.pet.x, y: this.windowState.pet.y };
    }

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const work = display.workArea;
    const margin = config.window.margin;
    const position = config.window.startPosition;
    let x = work.x + margin;
    let y = work.y + margin;

    if (position.endsWith('right')) x = work.x + work.width - width - margin;
    if (position.startsWith('bottom')) y = work.y + work.height - height - margin;
    if (position === 'center') {
      x = work.x + Math.round((work.width - width) / 2);
      y = work.y + Math.round((work.height - height) / 2);
    }

    return {
      x: clamp(x, work.x, Math.max(work.x, work.x + work.width - width)),
      y: clamp(y, work.y, Math.max(work.y, work.y + work.height - height)),
    };
  }

  createPetWindow() {
    if (this.petWindow && !this.petWindow.isDestroyed()) return this.petWindow;

    const config = this.getConfig();
    const width = config.window.pet.width;
    const height = config.window.pet.height;
    const position = this.resolvePetPosition(width, height);

    const pet = new BrowserWindow({
      width,
      height,
      x: position.x,
      y: position.y,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: !config.window.showInTaskbar,
      alwaysOnTop: config.window.alwaysOnTop,
      hasShadow: false,
      acceptFirstMouse: true,
      title: config.persona.name,
      icon: this.assetIconPath,
      webPreferences: this.webPreferencesFor('pet'),
    });
    this.petWindow = pet;
    this.secureWebContents(pet);
    pet.setMenuBarVisibility(false);

    pet.once('ready-to-show', () => {
      if (!pet || pet.isDestroyed()) return;
      if (config.window.showInTaskbar) pet.show();
      else pet.showInactive();
      this.petHidden = false;
      this.attachDisplayListener();
      this.onUiStateChanged();
      this.logger.info('Pet window shown', { bounds: pet.getBounds() });
    });

    pet.on('closed', () => {
      this.stopPetDrag();
      this.petWindow = null;
      this.onUiStateChanged();
    });

    pet.on('blur', () => {
      // If the renderer loses pointerup while the window is moving, do not keep
      // dragging forever. The renderer also ends the drag explicitly.
      this.stopPetDrag();
    });

    if (config.development.openDevTools) {
      pet.webContents.openDevTools({ mode: 'detach' });
    }

    pet.loadFile(path.join(this.rendererDir, 'pet', 'index.html')).catch((error) => {
      this.logger.error('Failed to load pet window', { error: error.message });
    });
    return pet;
  }

  showPet() {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    this.petHidden = false;
    if (this.config.window.showInTaskbar) this.petWindow.show();
    else this.petWindow.showInactive();
    this.onUiStateChanged();
  }

  hidePet() {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    this.hideChat();
    this.petWindow.hide();
    this.petHidden = true;
    this.onUiStateChanged();
  }

  togglePetVisibility() {
    if (!this.petWindow || this.petWindow.isDestroyed()) {
      this.createPetWindow();
      return;
    }
    if (this.petWindow.isVisible()) this.hidePet();
    else this.showPet();
  }

  focusPet() {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    this.showPet();
    this.petWindow.focus();
  }

  petVisible() {
    return Boolean(this.petWindow && !this.petWindow.isDestroyed() && this.petWindow.isVisible());
  }

  createChatWindow() {
    if (this.chatWindow && !this.chatWindow.isDestroyed()) return this.chatWindow;
    const config = this.getConfig();
    const chat = new BrowserWindow({
      width: config.window.chat.width,
      height: config.window.chat.height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: config.window.alwaysOnTop,
      hasShadow: false,
      title: `${config.persona.name} · 对话`,
      icon: this.assetIconPath,
      webPreferences: this.webPreferencesFor('chat'),
    });
    this.chatWindow = chat;
    this.secureWebContents(chat);

    chat.once('ready-to-show', () => {
      if (!chat || chat.isDestroyed()) return;
      this.positionChatWindow();
      chat.show();
      chat.focus();
      this.broadcast('pet', { type: 'chat-visible', visible: true });
      this.onUiStateChanged();
    });

    chat.on('closed', () => {
      this.chatWindow = null;
      this.broadcast('pet', { type: 'chat-visible', visible: false });
      this.onUiStateChanged();
    });

    if (config.development.openDevTools) {
      chat.webContents.openDevTools({ mode: 'detach' });
    }

    chat.loadFile(path.join(this.rendererDir, 'chat', 'index.html')).catch((error) => {
      this.logger.error('Failed to load chat window', { error: error.message });
    });
    return chat;
  }

  openChat() {
    if (!this.petWindow || this.petWindow.isDestroyed()) this.createPetWindow();
    if (!this.petVisible()) this.showPet();
    const chat = this.chatWindow;
    if (chat && !chat.isDestroyed()) {
      if (!chat.isVisible()) {
        this.positionChatWindow();
        chat.show();
        chat.focus();
        this.broadcast('pet', { type: 'chat-visible', visible: true });
        this.onUiStateChanged();
      } else {
        chat.focus();
      }
      return;
    }
    this.createChatWindow();
  }

  hideChat() {
    if (!this.chatWindow || this.chatWindow.isDestroyed()) return;
    if (!this.chatWindow.isVisible()) return;
    this.chatWindow.hide();
    this.broadcast('pet', { type: 'chat-visible', visible: false });
    this.onUiStateChanged();
  }

  toggleChat() {
    if (this.isChatVisible()) this.hideChat();
    else this.openChat();
  }

  isChatVisible() {
    return Boolean(this.chatWindow && !this.chatWindow.isDestroyed() && this.chatWindow.isVisible());
  }

  positionChatWindow() {
    if (!this.chatWindow || this.chatWindow.isDestroyed() || !this.petWindow || this.petWindow.isDestroyed()) return;
    const petBounds = this.petWindow.getBounds();
    const display = screen.getDisplayMatching(petBounds);
    const work = display.workArea;
    const current = this.chatWindow.getBounds();
    const width = Math.min(current.width, Math.max(360, work.width - 24));
    const height = Math.min(current.height, Math.max(460, work.height - 24));
    if (width !== current.width || height !== current.height) {
      this.chatWindow.setSize(width, height);
    }

    const gap = 12;
    let x;
    const spaceLeft = petBounds.x - work.x;
    const spaceRight = work.x + work.width - (petBounds.x + petBounds.width);
    if (spaceLeft >= width + gap) {
      x = petBounds.x - width - gap;
    } else if (spaceRight >= width + gap) {
      x = petBounds.x + petBounds.width + gap;
    } else {
      x = Math.round(petBounds.x + petBounds.width / 2 - width / 2);
    }
    x = clamp(x, work.x + 8, Math.max(work.x + 8, work.x + work.width - width - 8));

    let y = petBounds.y + petBounds.height - height;
    y = clamp(y, work.y + 8, Math.max(work.y + 8, work.y + work.height - height - 8));
    this.chatWindow.setPosition(Math.round(x), Math.round(y), false);
  }

  createSettingsWindow() {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.show();
      this.settingsWindow.focus();
      return this.settingsWindow;
    }

    const settings = new BrowserWindow({
      width: 1000,
      height: 760,
      minWidth: 860,
      minHeight: 620,
      show: false,
      backgroundColor: '#f3efe5',
      title: 'Desktop Robot · 配置',
      icon: this.assetIconPath,
      autoHideMenuBar: true,
      webPreferences: this.webPreferencesFor('settings'),
    });
    this.settingsWindow = settings;
    this.secureWebContents(settings);
    settings.setMenuBarVisibility(false);
    settings.setSkipTaskbar(false);

    settings.once('ready-to-show', () => {
      if (!settings || settings.isDestroyed()) return;
      settings.show();
      settings.focus();
    });
    settings.webContents.on('will-prevent-unload', (event) => {
      const choice = dialog.showMessageBoxSync(settings, {
        type: 'question',
        buttons: ['继续编辑', '放弃修改并关闭'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: '还有未保存的修改',
        message: '配置编辑器里还有未保存的修改。',
        detail: '关闭窗口会丢失这些修改。',
      });
      if (choice === 1) event.preventDefault();
    });
    settings.on('closed', () => {
      this.settingsWindow = null;
    });

    settings.loadFile(path.join(this.rendererDir, 'settings', 'index.html')).catch((error) => {
      this.logger.error('Failed to load settings window', { error: error.message });
    });
    return settings;
  }

  openSettings() {
    return this.createSettingsWindow();
  }

  broadcast(role, payload) {
    const window = this.windowForRole(role);
    if (!window || window.isDestroyed()) return;
    if (window.webContents.isLoadingMainFrame()) return;
    window.webContents.send('app:event', payload);
  }

  broadcastAll(payload) {
    for (const role of ['pet', 'chat', 'settings']) this.broadcast(role, payload);
  }

  setPetState(state, { durationMs = 0 } = {}) {
    if (!ALLOWED_PET_STATES.has(state)) return;
    if (this.petStateTimer) {
      clearTimeout(this.petStateTimer);
      this.petStateTimer = null;
    }
    this.broadcast('pet', { type: 'pet-state', state });

    if (durationMs > 0 && state !== 'idle') {
      this.petStateTimer = setTimeout(() => {
        this.petStateTimer = null;
        this.broadcast('pet', { type: 'pet-state', state: 'idle' });
      }, durationMs);
      this.petStateTimer.unref?.();
    }
  }

  showBubble(text, tone = 'info', durationMs = 0) {
    if (!text) return;
    const config = this.getConfig();
    this.broadcast('pet', {
      type: 'pet-bubble',
      text: String(text).slice(0, Math.max(20, config.appearance.bubbleMaxChars)),
      tone,
      durationMs: durationMs || config.appearance.bubbleDurationMs,
    });
  }

  startPetDrag() {
    if (this.dragInterval || !this.petWindow || this.petWindow.isDestroyed()) return;
    const startCursor = screen.getCursorScreenPoint();
    const startBounds = this.petWindow.getBounds();
    this.dragSession = { startCursor, startBounds };
    this.dragInterval = setInterval(() => {
      if (!this.petWindow || this.petWindow.isDestroyed() || !this.dragSession) {
        this.stopPetDrag();
        return;
      }
      const cursor = screen.getCursorScreenPoint();
      const x = Math.round(startBounds.x + cursor.x - startCursor.x);
      const y = Math.round(startBounds.y + cursor.y - startCursor.y);
      this.petWindow.setPosition(x, y, false);
      if (this.isChatVisible()) this.positionChatWindow();
    }, 16);
    this.dragSafety = setTimeout(() => this.stopPetDrag(), 60000);
    this.dragSafety.unref?.();
  }

  stopPetDrag({ save = true } = {}) {
    if (this.dragInterval) {
      clearInterval(this.dragInterval);
      this.dragInterval = null;
    }
    if (this.dragSafety) {
      clearTimeout(this.dragSafety);
      this.dragSafety = null;
    }
    const wasDragging = Boolean(this.dragSession);
    this.dragSession = null;
    if (!wasDragging || !save) return;
    if (!this.petWindow || this.petWindow.isDestroyed()) return;

    const bounds = this.petWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const work = display.workArea;
    const x = clamp(bounds.x, work.x, Math.max(work.x, work.x + work.width - bounds.width));
    const y = clamp(bounds.y, work.y, Math.max(work.y, work.y + work.height - bounds.height));
    if (x !== bounds.x || y !== bounds.y) this.petWindow.setPosition(x, y, false);

    if (this.getConfig().window.rememberPosition) {
      this.windowState = { pet: { x, y } };
      writeWindowState(this.windowStatePath, this.windowState);
    }
    if (this.isChatVisible()) this.positionChatWindow();
  }

  applyConfig() {
    this.config = this.getConfig();
    const publicConfig = this.getPublicConfig();
    for (const window of [this.petWindow, this.chatWindow]) {
      this.applyWindowFlags(window);
    }

    if (this.petWindow && !this.petWindow.isDestroyed()) {
      const bounds = this.petWindow.getBounds();
      const targetWidth = this.config.window.pet.width;
      const targetHeight = this.config.window.pet.height;
      if (bounds.width !== targetWidth || bounds.height !== targetHeight) {
        const x = bounds.x + bounds.width - targetWidth;
        const y = bounds.y + bounds.height - targetHeight;
        this.petWindow.setBounds({ x, y, width: targetWidth, height: targetHeight });
      }
      if (this.isChatVisible()) this.positionChatWindow();
    }

    if (this.chatWindow && !this.chatWindow.isDestroyed()) {
      this.chatWindow.setSize(
        this.config.window.chat.width,
        this.config.window.chat.height,
      );
      if (this.isChatVisible()) this.positionChatWindow();
    }

    this.broadcastAll({
      type: 'config-changed',
      config: publicConfig,
    });
  }

  destroy() {
    this.quitting = true;
    this.stopPetDrag({ save: false });
    if (this.petStateTimer) clearTimeout(this.petStateTimer);
    this.petStateTimer = null;
    if (this.displayListener) {
      screen.removeListener('display-metrics-changed', this.displayListener);
      screen.removeListener('display-added', this.displayListener);
      screen.removeListener('display-removed', this.displayListener);
      this.displayListener = null;
    }
  }

  buildMenuTemplate({ onReloadConfig, onOpenConfigFile, onQuit }) {
    const name = this.config.persona.name;
    return [
      {
        label: this.petVisible() ? `隐藏${name}` : `显示${name}`,
        click: () => this.togglePetVisibility(),
      },
      {
        label: this.isChatVisible() ? '隐藏聊天' : '打开聊天',
        click: () => this.toggleChat(),
      },
      { type: 'separator' },
      { label: '设置…', click: () => this.openSettings() },
      { label: '重新加载配置', click: () => onReloadConfig() },
      { label: '打开配置文件', click: () => onOpenConfigFile() },
      { type: 'separator' },
      { label: '语音接口：预留（未启用）', enabled: false },
      { type: 'separator' },
      { label: '退出', click: () => onQuit() },
    ];
  }

  showContextMenu(buildTemplate) {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    const menu = Menu.buildFromTemplate(buildTemplate());
    menu.popup({ window: this.petWindow });
  }
}

module.exports = {
  WindowManager,
};
