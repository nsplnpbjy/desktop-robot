'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  dialog,
  Menu,
  net,
  session,
  shell,
} = require('electron');

const logger = require('./logger');
const {
  ConfigError,
  createFallbackLoadedConfig,
  loadConfigFile,
  parseConfigText,
  readConfigText,
  resolveConfigPath,
  saveConfigText: writeConfigText,
  toPublicConfig,
  toSettingsMeta,
} = require('./config');
const { applyProxySettings, describeProxySettings } = require('./proxy');
const { ConversationStore } = require('./conversation');
const { VoiceService } = require('./voice');
const { WindowManager } = require('./windows');
const { ChatService } = require('./chat-service');
const { createAppTray } = require('./tray');
const { registerIpc } = require('./ipc');

// Names and userData overrides must be set before the single-instance lock.
app.setName('Desktop Robot');
if (process.env.DESKTOP_ROBOT_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.DESKTOP_ROBOT_USER_DATA));
}
app.setAppUserModelId('com.desktoprobot.app');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

const APP_PATH = app.getAppPath();
const PRELOAD_PATH = path.join(__dirname, '..', 'preload', 'index.js');
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const ICON_PATH = path.join(APP_PATH, 'assets', 'icons', 'icon.png');
const TRAY_ICON_PATH = path.join(APP_PATH, 'assets', 'icons', 'tray.png');

let configPath = '';
let loadedConfig = null;
let configStatus = { ok: false, errors: [], warnings: [] };
let configRevision = 0;
let proxyAuth = null;
let proxyRuntimeStatus = null;
let windowsManager = null;
let chatService = null;
let voiceService = null;
let trayHandle = null;
let conversation = null;
let configWatcherTimer = null;
let assetWatcher = null;
let assetWatcherDir = '';
let assetWatcherTimer = null;
let operationChain = Promise.resolve();
let quitting = false;
let started = false;

function enqueue(operation) {
  const result = operationChain.then(operation, operation);
  operationChain = result.catch(() => {});
  return result;
}

function currentConfig() {
  return loadedConfig?.config ?? null;
}

function buildPublicConfig() {
  if (!loadedConfig) return null;
  return toPublicConfig(loadedConfig, {
    revision: configRevision,
    configStatus,
    voiceStatus: voiceService?.getStatus(),
    appVersion: app.getVersion(),
    proxyStatus: proxyRuntimeStatus,
  });
}

function buildSettingsMeta() {
  if (!loadedConfig) return null;
  return toSettingsMeta(loadedConfig, {
    configPath,
    configStatus,
    voiceStatus: voiceService?.getStatus(),
    appVersion: app.getVersion(),
    proxyStatus: proxyRuntimeStatus,
  });
}

function setConfigStatus({ errors = [], warnings = [] }) {
  configStatus = {
    ok: errors.length === 0,
    errors: [...errors],
    warnings: [...warnings],
  };
  configRevision += 1;
}

async function applyProxy(config) {
  try {
    const result = await applyProxySettings(session.defaultSession, config.network.proxy);
    proxyRuntimeStatus = {
      mode: result.mode,
      display: result.display,
      enabled: result.mode !== 'direct',
      authenticated: Boolean(result.username || result.password),
    };
    proxyAuth = result.auth;
    return { ok: true };
  } catch (error) {
    proxyRuntimeStatus = {
      mode: config.network.proxy.mode,
      display: '配置有误',
      enabled: false,
      error: error.message,
      authenticated: false,
    };
    proxyAuth = null;
    logger.warn('Proxy configuration failed', { message: error.message });
    return { ok: false, message: error.message };
  }
}

function applyLoginItemSettings(config) {
  if (!['win32', 'darwin'].includes(process.platform)) return;
  try {
    const settings = { openAtLogin: Boolean(config.app.launchAtLogin) };
    if (!app.isPackaged) {
      settings.path = process.execPath;
      settings.args = [APP_PATH];
    }
    app.setLoginItemSettings(settings);
  } catch (error) {
    logger.warn('Could not update launch-at-login setting', { message: error.message });
  }
}

async function applyLoadedConfig(loaded, { reason = 'reload', skipProxy = false } = {}) {
  const previous = loadedConfig;
  const configChanged = !previous || previous.hash !== loaded.hash;

  loadedConfig = loaded;
  let warnings = [...loaded.warnings];

  if (!skipProxy || configChanged) {
    const proxyResult = await applyProxy(loaded.config);
    if (!proxyResult.ok) {
      warnings.push(`代理配置未能应用：${proxyResult.message}`);
    }
  } else if (proxyRuntimeStatus?.error) {
    warnings.push(`代理配置未能应用：${proxyRuntimeStatus.error}`);
  }

  setConfigStatus({ errors: [], warnings });
  chatService?.applyConfig(loaded);
  windowsManager?.applyConfig();
  setupAssetWatcher(loaded);
  applyLoginItemSettings(loaded.config);
  trayHandle?.refresh();

  logger.info('Configuration applied', {
    reason,
    revision: configRevision,
    provider: loaded.providerMeta?.name,
    proxy: proxyRuntimeStatus?.mode,
    warnings: warnings.length,
  });
}

function markConfigInvalid(error, rawText = '') {
  setConfigStatus({
    errors: error?.errors?.length ? error.errors : [error?.message || '未知配置错误'],
    warnings: error?.warnings || [],
  });
  logger.warn('Configuration is invalid; keeping the last usable configuration', {
    errors: configStatus.errors.length,
  });
  if (windowsManager && voiceService) {
    windowsManager.broadcastAll({
      type: 'config-changed',
      config: buildPublicConfig(),
    });
    trayHandle?.refresh();
  }
  return {
    ok: false,
    rawText,
    errors: configStatus.errors,
    warnings: configStatus.warnings,
    meta: buildSettingsMeta(),
  };
}

function getSettingsData() {
  let rawText = '';
  let readError = '';
  try {
    rawText = readConfigText(configPath);
  } catch (error) {
    readError = error.message;
  }
  return {
    ok: !readError,
    rawText,
    error: readError || undefined,
    meta: buildSettingsMeta(),
  };
}

async function reloadFromDisk({ force = false, reason = 'manual' } = {}) {
  return enqueue(async () => {
    let rawText = '';
    try {
      rawText = readConfigText(configPath);
      const parsed = parseConfigText(rawText, { configPath, appPath: APP_PATH });
      const unchanged = loadedConfig?.hash === parsed.hash && configStatus.ok;
      if (unchanged && !force) {
        return { ok: true, rawText, meta: buildSettingsMeta(), unchanged: true };
      }

      await applyLoadedConfig(parsed, {
        reason,
        skipProxy: reason === 'animations',
      });
      return { ok: true, rawText, meta: buildSettingsMeta() };
    } catch (error) {
      if (!(error instanceof ConfigError)) {
        logger.error('Unexpected error while reloading config', { message: error.message });
      }
      const result = markConfigInvalid(error, rawText);
      return result;
    }
  });
}

async function saveConfigText(text) {
  return enqueue(async () => {
    try {
      const parsed = writeConfigText(text, { configPath, appPath: APP_PATH });
      await applyLoadedConfig(parsed, { reason: 'save' });
      logger.info('Configuration saved');
      return {
        ok: true,
        rawText: text,
        meta: buildSettingsMeta(),
      };
    } catch (error) {
      if (!(error instanceof ConfigError)) {
        logger.error('Unexpected error while saving config', { message: error.message });
      } else {
        logger.warn('Configuration save rejected', { errors: error.errors });
      }
      return {
        ok: false,
        rawText: text,
        errors: error?.errors?.length ? error.errors : [error.message],
        warnings: error?.warnings || [],
        meta: buildSettingsMeta(),
      };
    }
  });
}

function setupConfigWatcher() {
  try {
    fs.watchFile(configPath, { interval: 800 }, (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
      if (configWatcherTimer) clearTimeout(configWatcherTimer);
      configWatcherTimer = setTimeout(() => {
        configWatcherTimer = null;
        reloadFromDisk({ force: false, reason: 'file-watch' }).catch((error) => {
          logger.warn('Config watch reload failed', { message: error.message });
        });
      }, 450);
      configWatcherTimer.unref?.();
    });
  } catch (error) {
    logger.warn('Could not watch config file', { message: error.message });
  }
}

function setupAssetWatcher(loaded) {
  const config = loaded.config;
  const wanted = config.appearance.watchAnimations ? loaded.assets.animationsDir : '';
  if (assetWatcher && wanted === assetWatcherDir) return;

  if (assetWatcher) {
    assetWatcher.close();
    assetWatcher = null;
    assetWatcherDir = '';
  }
  if (!wanted) return;

  try {
    assetWatcher = fs.watch(wanted, { persistent: false }, () => {
      if (assetWatcherTimer) clearTimeout(assetWatcherTimer);
      assetWatcherTimer = setTimeout(() => {
        assetWatcherTimer = null;
        reloadFromDisk({ force: true, reason: 'animations' }).catch((error) => {
          logger.warn('Animation watch reload failed', { message: error.message });
        });
      }, 650);
      assetWatcherTimer.unref?.();
    });
    assetWatcher.on('error', (error) => {
      logger.warn('Animation directory watcher failed', { message: error.message });
    });
    assetWatcherDir = wanted;
  } catch (error) {
    logger.warn('Could not watch animation directory', { message: error.message });
  }
}

function installProxyLoginHandler() {
  app.on('login', (event, webContents, details, authInfo, callback) => {
    if (!authInfo?.isProxy) return;
    event.preventDefault();
    if (typeof callback === 'function') {
      callback(proxyAuth?.username || '', proxyAuth?.password || '');
    }
  });
}

function configActions() {
  return {
    onReloadConfig: async () => {
      const result = await reloadFromDisk({ force: true, reason: 'menu' });
      if (windowsManager) {
        if (result.ok) windowsManager.showBubble('配置已重新加载', 'success', 2200);
        else windowsManager.showBubble('配置有误，打开设置检查一下', 'error', 5000);
      }
      return result;
    },
    onOpenConfigFile: async () => {
      try {
        const error = await shell.openPath(configPath);
        if (error) {
          windowsManager?.openSettings();
          return {
            ok: false,
            message: '系统没有可直接打开 YAML 的编辑器，已打开内置配置编辑器。',
          };
        }
        return { ok: true };
      } catch (error) {
        windowsManager?.openSettings();
        return { ok: false, message: error.message };
      }
    },
    onQuit: () => {
      quitting = true;
      app.quit();
    },
  };
}

function buildMenuActions() {
  return {
    onReloadConfig: () => {
      configActions().onReloadConfig();
    },
    onOpenConfigFile: () => {
      configActions().onOpenConfigFile();
    },
    onQuit: () => {
      quitting = true;
      app.quit();
    },
  };
}

function showPetMenu() {
  if (!windowsManager) return;
  windowsManager.showContextMenu(() => windowsManager.buildMenuTemplate(buildMenuActions()));
}

async function openAnimationsFolder() {
  const dir = loadedConfig?.assets?.animationsDir;
  if (!dir) return { ok: false, message: '尚未配置动画目录' };
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return { ok: false, message: '动画目录不是一个文件夹' };
  } catch {
    return { ok: false, message: `动画目录不存在：${dir}` };
  }
  const error = await shell.openPath(dir);
  return error ? { ok: false, message: error } : { ok: true };
}

async function openLogFile() {
  const filePath = logger.getLogFilePath();
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, message: '日志文件尚未创建' };
  }
  const error = await shell.openPath(filePath);
  return error ? { ok: false, message: error } : { ok: true };
}

async function start() {
  if (started) return;
  started = true;

  Menu.setApplicationMenu(null);

  try {
    configPath = resolveConfigPath({
      appPath: APP_PATH,
      userDataPath: app.getPath('userData'),
      isPackaged: app.isPackaged,
      argv: process.argv,
      env: process.env,
    });
  } catch (error) {
    dialog.showErrorBox('Desktop Robot 无法启动', error.message);
    app.quit();
    return;
  }

  let initialError = null;
  try {
    loadedConfig = loadConfigFile(configPath, { appPath: APP_PATH });
    setConfigStatus({ errors: [], warnings: loadedConfig.warnings });
  } catch (error) {
    initialError = error;
    const errors = error?.errors?.length ? error.errors : [error.message];
    const warnings = error?.warnings || [];
    loadedConfig = createFallbackLoadedConfig({
      configPath,
      appPath: APP_PATH,
      errors,
      warnings,
    });
    setConfigStatus({ errors, warnings });
  }

  const logDir = path.join(app.getPath('userData'), 'logs');
  logger.initLogger({
    dir: logDir,
    level: loadedConfig.config.logging.level,
    file: loadedConfig.config.logging.file,
  });
  logger.info('Desktop Robot starting', {
    version: app.getVersion(),
    electron: process.versions.electron,
    configPath,
    initialConfigValid: !initialError,
  });
  if (initialError) {
    logger.warn('Initial configuration is invalid', { errors: initialError.errors || [initialError.message] });
  }

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { message: error.message, stack: error.stack });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', {
      message: reason instanceof Error ? reason.message : String(reason),
    });
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  const proxyResult = await applyProxy(loadedConfig.config);
  if (!proxyResult.ok) {
    const warnings = [...configStatus.warnings, `代理配置未能应用：${proxyResult.message}`];
    setConfigStatus({ errors: configStatus.errors, warnings });
  } else {
    setConfigStatus({ errors: configStatus.errors, warnings: configStatus.warnings });
  }
  installProxyLoginHandler();

  voiceService = new VoiceService({ getConfig: currentConfig });

  conversation = new ConversationStore({
    maxMessages: loadedConfig.config.chat.maxHistoryMessages,
    persist: loadedConfig.config.chat.persistHistory,
    persistPath: path.join(app.getPath('userData'), 'conversation.json'),
    onWarning: (message, error) => logger.warn(message, { message: error?.message }),
  });

  let trayRefresh = null;
  windowsManager = new WindowManager({
    app,
    preloadPath: PRELOAD_PATH,
    rendererDir: RENDERER_DIR,
    assetIconPath: ICON_PATH,
    userDataPath: app.getPath('userData'),
    getConfig: currentConfig,
    getPublicConfig: buildPublicConfig,
    logger,
    onUiStateChanged: () => trayRefresh?.(),
  });

  chatService = new ChatService({
    getState: () => ({ loaded: loadedConfig, configStatus }),
    conversation,
    windows: windowsManager,
    fetchImpl: (input, init) => net.fetch(input, init),
    logger,
  });
  chatService.applyConfig(loadedConfig);

  registerIpc({
    windows: windowsManager,
    chatService,
    runtime: {
      publicConfig: buildPublicConfig,
      getSettingsData,
      saveConfigText,
      reloadFromDisk,
      configPath: () => configPath,
    },
    actions: {
      showPetMenu,
      openConfigFile: configActions().onOpenConfigFile,
      openAnimationsFolder,
      openLogFile,
    },
    logger,
  });

  trayHandle = createAppTray({
    iconPath: TRAY_ICON_PATH,
    windows: windowsManager,
    actions: buildMenuActions(),
    logger,
  });
  trayRefresh = () => trayHandle?.refresh();

  setupConfigWatcher();
  setupAssetWatcher(loadedConfig);
  applyLoginItemSettings(loadedConfig.config);

  windowsManager.createPetWindow();
  windowsManager.onUiStateChanged = () => trayHandle?.refresh();

  if (loadedConfig.config.window.openChatOnStart) {
    setTimeout(() => windowsManager?.openChat(), 400);
  }

  logger.info('Desktop Robot ready', {
    provider: loadedConfig.providerMeta?.name,
    configOk: configStatus.ok,
  });
}

app.on('second-instance', () => {
  windowsManager?.focusPet();
  if (configStatus.errors.length) windowsManager?.openSettings();
});

app.on('activate', () => {
  windowsManager?.showPet();
});

app.on('window-all-closed', () => {
  // The app lives in the tray, so closing a window must not terminate it.
});

app.on('before-quit', () => {
  if (quitting) return;
  quitting = true;
});

app.on('will-quit', () => {
  if (configWatcherTimer) clearTimeout(configWatcherTimer);
  if (assetWatcherTimer) clearTimeout(assetWatcherTimer);
  if (configPath) {
    try {
      fs.unwatchFile(configPath);
    } catch {
      // Ignore cleanup failures.
    }
  }
  assetWatcher?.close();
  trayHandle?.destroy();
  windowsManager?.destroy();
  logger.closeLogger();
});

if (gotSingleInstanceLock) {
  app.whenReady().then(start).catch((error) => {
    logger.error('Startup failed', { message: error.message, stack: error.stack });
    dialog.showErrorBox('Desktop Robot 启动失败', error.message);
    app.quit();
  });
}
