'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const YAML = require('yaml');

const {
  ANIMATION_STATES,
  PROVIDER_TYPES,
  PROVIDER_TYPE_ALIASES,
  RESERVED_VOICE_REASON,
  createDefaults,
} = require('./defaults');
const { describeApiKey } = require('./secrets');
const { parseProxySettings, describeProxySettings } = require('./proxy');

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

class ConfigError extends Error {
  constructor(message, { errors = [], warnings = [], cause } = {}) {
    super(message, { cause });
    this.name = 'ConfigError';
    this.errors = errors.length ? errors : [message];
    this.warnings = warnings;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeKey(key) {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function deepMerge(base, override) {
  if (Array.isArray(override)) return override.slice();
  if (!isPlainObject(override)) {
    return override === undefined ? base : override;
  }

  const result = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(override)) {
    if (!isSafeKey(key)) continue;
    if (value === undefined) continue;
    result[key] = isPlainObject(value) && isPlainObject(result[key])
      ? deepMerge(result[key], value)
      : deepMerge(undefined, value);
  }
  return result;
}

function getArgumentValue(argv, name) {
  const direct = `--${name}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith(direct)) return argument.slice(direct.length);
    if (argument === `--${name}`) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) return next;
    }
  }
  return '';
}

function seedConfig(examplePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const text = fs.readFileSync(examplePath, 'utf8');
  fs.writeFileSync(targetPath, text, 'utf8');
}

/**
 * Explicit --config / DESKTOP_ROBOT_CONFIG wins. In development the project
 * config is used and seeded from config.example.yaml. A packaged app gets its
 * own copy under userData so application updates never overwrite user config.
 */
function resolveConfigPath({
  appPath,
  userDataPath,
  isPackaged = false,
  argv = process.argv,
  env = process.env,
}) {
  const explicit = getArgumentValue(argv, 'config') || env.DESKTOP_ROBOT_CONFIG || '';
  if (explicit) {
    return path.resolve(process.cwd(), explicit);
  }

  if (!isPackaged) {
    const projectConfig = path.join(appPath, 'config', 'config.yaml');
    if (!fs.existsSync(projectConfig)) {
      const example = path.join(appPath, 'config', 'config.example.yaml');
      if (!fs.existsSync(example)) {
        throw new ConfigError(`找不到示例配置文件：${example}`);
      }
      seedConfig(example, projectConfig);
    }
    return projectConfig;
  }

  const userConfig = path.join(userDataPath, 'config.yaml');
  if (!fs.existsSync(userConfig)) {
    const example = path.join(appPath, 'config', 'config.example.yaml');
    if (!fs.existsSync(example)) {
      throw new ConfigError(`安装包中缺少示例配置：${example}`);
    }
    seedConfig(example, userConfig);
  }
  return userConfig;
}

function readConfigText(configPath) {
  try {
    return fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new ConfigError(`配置文件不存在：${configPath}`, {
        errors: [`配置文件不存在：${configPath}`],
      });
    }
    throw new ConfigError(`无法读取配置文件：${error.message}`, {
      errors: [`无法读取配置文件：${error.message}`],
    });
  }
}

function expandConfigPath(value, { appPath, configDir }) {
  return String(value)
    .replaceAll('${APP_DIR}', appPath)
    .replaceAll('${CONFIG_DIR}', configDir);
}

function resolvePathFromConfig(value, { appPath, configDir, baseDir = configDir }) {
  const expanded = expandConfigPath(value, { appPath, configDir });
  return path.isAbsolute(expanded)
    ? path.normalize(expanded)
    : path.resolve(baseDir, expanded);
}

function inspectAssets(config, { appPath, configPath }) {
  const configDir = path.dirname(configPath);
  let animationsDir = '';
  try {
    animationsDir = resolvePathFromConfig(config.appearance.animationsDir, {
      appPath,
      configDir,
    });
  } catch {
    animationsDir = path.resolve(configDir, 'assets', 'animations');
  }

  const animations = {};
  for (const state of ANIMATION_STATES) {
    const configured = config.appearance.animations?.[state];
    if (!configured) {
      animations[state] = {
        state,
        configured: '',
        file: '',
        exists: false,
        size: 0,
        mtimeMs: 0,
      };
      continue;
    }

    const file = path.isAbsolute(String(configured))
      ? path.normalize(String(configured))
      : path.resolve(animationsDir, String(configured));

    let exists = false;
    let size = 0;
    let mtimeMs = 0;
    try {
      const stat = fs.statSync(file);
      exists = stat.isFile();
      size = stat.size;
      mtimeMs = stat.mtimeMs;
    } catch {
      exists = false;
    }

    animations[state] = {
      state,
      configured: String(configured),
      file,
      exists,
      size,
      mtimeMs,
    };
  }

  let fallbackImage = '';
  let fallbackExists = false;
  let fallbackMtimeMs = 0;
  if (config.appearance.fallbackImage) {
    fallbackImage = resolvePathFromConfig(config.appearance.fallbackImage, {
      appPath,
      configDir,
    });
    try {
      const stat = fs.statSync(fallbackImage);
      fallbackExists = stat.isFile();
      fallbackMtimeMs = stat.mtimeMs;
    } catch {
      fallbackExists = false;
    }
  }

  let animationsDirExists = false;
  try {
    animationsDirExists = fs.statSync(animationsDir).isDirectory();
  } catch {
    animationsDirExists = false;
  }

  return {
    animationsDir,
    animationsDirExists,
    animations,
    fallbackImage,
    fallbackExists,
    fallbackMtimeMs,
  };
}

function validateConfig(config, { env }) {
  const errors = [];
  const warnings = [];
  const addError = (message) => errors.push(message);
  const addWarning = (message) => warnings.push(message);
  const defaults = createDefaults();

  const ensureObject = (value, fallback, label) => {
    if (isPlainObject(value)) return value;
    addError(`${label} 必须是 YAML 对象`);
    return fallback;
  };

  // Repair missing/wrong-typed sections with defaults so validation can report
  // friendly errors instead of crashing on property access.
  config.app = ensureObject(config.app, defaults.app, 'app');
  config.logging = ensureObject(config.logging, defaults.logging, 'logging');
  config.development = ensureObject(config.development, defaults.development, 'development');
  config.window = ensureObject(config.window, defaults.window, 'window');
  config.window.pet = ensureObject(config.window.pet, defaults.window.pet, 'window.pet');
  config.window.chat = ensureObject(config.window.chat, defaults.window.chat, 'window.chat');
  config.appearance = ensureObject(config.appearance, defaults.appearance, 'appearance');
  config.appearance.animations = ensureObject(
    config.appearance.animations,
    defaults.appearance.animations,
    'appearance.animations',
  );
  config.persona = ensureObject(config.persona, defaults.persona, 'persona');
  config.chat = ensureObject(config.chat, defaults.chat, 'chat');
  config.llm = ensureObject(config.llm, defaults.llm, 'llm');
  config.llm.providers = ensureObject(config.llm.providers, {}, 'llm.providers');
  config.network = ensureObject(config.network, defaults.network, 'network');
  config.network.proxy = ensureObject(
    config.network.proxy,
    defaults.network.proxy,
    'network.proxy',
  );
  config.voice = ensureObject(config.voice, defaults.voice, 'voice');
  config.voice.input = ensureObject(config.voice.input, defaults.voice.input, 'voice.input');
  config.voice.output = ensureObject(config.voice.output, defaults.voice.output, 'voice.output');

  if (config.version !== 1) {
    addError(`配置 version 必须为 1，当前为 ${JSON.stringify(config.version)}`);
  }

  if (typeof config.app.launchAtLogin !== 'boolean') {
    addError('app.launchAtLogin 必须是 true 或 false');
  }
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(config.logging.level)) {
    addError('logging.level 必须是 debug、info、warn、error 或 silent');
  }
  if (typeof config.logging.file !== 'boolean') {
    addError('logging.file 必须是 true 或 false');
  }
  if (typeof config.development.openDevTools !== 'boolean') {
    addError('development.openDevTools 必须是 true 或 false');
  }

  const dimensions = [
    ['window.pet.width', config.window.pet.width, 300, 900],
    ['window.pet.height', config.window.pet.height, 360, 1000],
    ['window.chat.width', config.window.chat.width, 360, 1000],
    ['window.chat.height', config.window.chat.height, 460, 1000],
  ];
  for (const [label, value, min, max] of dimensions) {
    if (!Number.isInteger(value) || value < min || value > max) {
      addError(`${label} 必须是 ${min}-${max} 之间的整数`);
    }
  }
  if (!['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center'].includes(config.window.startPosition)) {
    addError('window.startPosition 必须是 bottom-right、bottom-left、top-right、top-left 或 center');
  }
  if (!Number.isInteger(config.window.margin) || config.window.margin < 0 || config.window.margin > 200) {
    addError('window.margin 必须是 0-200 之间的整数');
  }
  for (const key of [
    'rememberPosition',
    'alwaysOnTop',
    'showInTaskbar',
    'openChatOnStart',
    'closeChatOnEscape',
  ]) {
    if (typeof config.window[key] !== 'boolean') {
      addError(`window.${key} 必须是 true 或 false`);
    }
  }

  if (!config.appearance.animationsDir || typeof config.appearance.animationsDir !== 'string') {
    addError('appearance.animationsDir 必须是非空字符串');
  }
  if (!isPlainObject(config.appearance.animations)) {
    addError('appearance.animations 必须是状态到 GIF 文件名的映射');
  } else {
    for (const state of ANIMATION_STATES) {
      const value = config.appearance.animations[state];
      if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
        addError(`appearance.animations.${state} 必须是非空文件名`);
      }
    }
    if (!config.appearance.animations.idle) {
      addWarning('appearance.animations.idle 未配置，空闲时将使用内置占位图');
    }
  }
  if (typeof config.appearance.fallbackImage !== 'string') {
    addError('appearance.fallbackImage 必须是文件路径字符串');
  }
  if (typeof config.appearance.watchAnimations !== 'boolean') {
    addError('appearance.watchAnimations 必须是 true 或 false');
  }
  if (!HEX_COLOR_RE.test(String(config.appearance.accentColor))) {
    addError('appearance.accentColor 必须是 #RRGGBB 格式的颜色');
  }
  if (!Number.isInteger(config.appearance.bubbleDurationMs) || config.appearance.bubbleDurationMs < 1000 || config.appearance.bubbleDurationMs > 60000) {
    addError('appearance.bubbleDurationMs 必须是 1000-60000 之间的整数');
  }
  if (!Number.isInteger(config.appearance.bubbleMaxChars) || config.appearance.bubbleMaxChars < 20 || config.appearance.bubbleMaxChars > 500) {
    addError('appearance.bubbleMaxChars 必须是 20-500 之间的整数');
  }
  if (typeof config.appearance.showReplyBubble !== 'boolean') {
    addError('appearance.showReplyBubble 必须是 true 或 false');
  }

  if (typeof config.persona.name !== 'string' || !config.persona.name.trim()) {
    addError('persona.name 必须是非空字符串');
  }
  if (typeof config.persona.greeting !== 'string') {
    addError('persona.greeting 必须是字符串');
  }
  if (typeof config.persona.inputPlaceholder !== 'string') {
    addError('persona.inputPlaceholder 必须是字符串');
  }
  if (typeof config.persona.systemPrompt !== 'string' || !config.persona.systemPrompt.trim()) {
    addError('persona.systemPrompt 必须是非空字符串');
  }
  for (const key of ['thinkingText', 'errorText', 'voiceReservedText']) {
    if (typeof config.persona[key] !== 'string') {
      addError(`persona.${key} 必须是字符串`);
    }
  }

  if (!Number.isInteger(config.chat.maxHistoryMessages) || config.chat.maxHistoryMessages < 2 || config.chat.maxHistoryMessages > 100) {
    addError('chat.maxHistoryMessages 必须是 2-100 之间的整数');
  }
  if (!Number.isInteger(config.chat.maxInputChars) || config.chat.maxInputChars < 1 || config.chat.maxInputChars > 20000) {
    addError('chat.maxInputChars 必须是 1-20000 之间的整数');
  }
  if (typeof config.chat.temperature !== 'number' || config.chat.temperature < 0 || config.chat.temperature > 2) {
    addError('chat.temperature 必须是 0-2 之间的数字');
  }
  if (!Number.isInteger(config.chat.maxOutputTokens) || config.chat.maxOutputTokens < 1 || config.chat.maxOutputTokens > 32000) {
    addError('chat.maxOutputTokens 必须是 1-32000 之间的整数');
  }
  if (!Number.isInteger(config.chat.timeoutMs) || config.chat.timeoutMs < 1000 || config.chat.timeoutMs > 300000) {
    addError('chat.timeoutMs 必须是 1000-300000 之间的整数');
  }
  if (typeof config.chat.persistHistory !== 'boolean') {
    addError('chat.persistHistory 必须是 true 或 false');
  }

  if (!isPlainObject(config.llm.providers) || Object.keys(config.llm.providers).length === 0) {
    addError('llm.providers 至少需要配置一个模型供应商');
  } else {
    for (const [name, provider] of Object.entries(config.llm.providers)) {
      if (!isPlainObject(provider)) {
        addError(`llm.providers.${name} 必须是对象`);
        continue;
      }

      const rawType = typeof provider.type === 'string' ? provider.type.trim() : '';
      const canonicalType = PROVIDER_TYPE_ALIASES[rawType] || rawType;
      if (!PROVIDER_TYPES.includes(canonicalType)) {
        addError(
          `llm.providers.${name}.type 不受支持（${rawType || '空'}）。可选值：${PROVIDER_TYPES.join('、')}`,
        );
      } else {
        provider.type = canonicalType;
      }

      if (typeof provider.model !== 'string' || !provider.model.trim()) {
        addError(`llm.providers.${name}.model 必须是非空字符串`);
      }
      if (typeof provider.baseUrl !== 'string' || !provider.baseUrl.trim()) {
        addError(`llm.providers.${name}.baseUrl 必须是非空 URL`);
      } else {
        try {
          const parsed = new URL(provider.baseUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            addError(`llm.providers.${name}.baseUrl 只支持 http 或 https`);
          }
        } catch {
          addError(`llm.providers.${name}.baseUrl 不是有效的 URL`);
        }
      }

      if (provider.apiKey !== undefined && typeof provider.apiKey !== 'string') {
        addError(`llm.providers.${name}.apiKey 必须是字符串`);
      }
      if (provider.apiKeyEnv !== undefined) {
        if (typeof provider.apiKeyEnv !== 'string') {
          addError(`llm.providers.${name}.apiKeyEnv 必须是字符串`);
        } else if (provider.apiKeyEnv && !ENV_NAME_RE.test(provider.apiKeyEnv)) {
          addError(`llm.providers.${name}.apiKeyEnv 不是合法的环境变量名`);
        }
      }
      if (provider.requiresApiKey !== undefined && typeof provider.requiresApiKey !== 'boolean') {
        addError(`llm.providers.${name}.requiresApiKey 必须是 true 或 false`);
      }
      if (provider.headers !== undefined) {
        if (!isPlainObject(provider.headers)) {
          addError(`llm.providers.${name}.headers 必须是键值对象`);
        } else {
          for (const [header, value] of Object.entries(provider.headers)) {
            if (!['string', 'number', 'boolean'].includes(typeof value)) {
              addError(`llm.providers.${name}.headers.${header} 必须是字符串或数字`);
            }
          }
        }
      }
      if (provider.extraBody !== undefined && !isPlainObject(provider.extraBody)) {
        addError(`llm.providers.${name}.extraBody 必须是对象`);
      }
      for (const [key, min, max] of [
        ['temperature', 0, 2],
        ['maxOutputTokens', 1, 32000],
        ['timeoutMs', 1000, 300000],
      ]) {
        if (provider[key] !== undefined) {
          const value = provider[key];
          if (typeof value !== 'number' || value < min || value > max ||
              (key !== 'temperature' && !Number.isInteger(value))) {
            addError(`llm.providers.${name}.${key} 必须是 ${min}-${max} 之间的${key === 'temperature' ? '数字' : '整数'}`);
          }
        }
      }
      if (provider.maxTokensParam !== undefined && typeof provider.maxTokensParam !== 'string') {
        addError(`llm.providers.${name}.maxTokensParam 必须是字符串`);
      }
      if (provider.anthropicVersion !== undefined && typeof provider.anthropicVersion !== 'string') {
        addError(`llm.providers.${name}.anthropicVersion 必须是字符串`);
      }
      if (provider.agentId !== undefined && typeof provider.agentId !== 'string') {
        addError(`llm.providers.${name}.agentId 必须是字符串`);
      }
      if (provider.sessionUser !== undefined && typeof provider.sessionUser !== 'string') {
        addError(`llm.providers.${name}.sessionUser 必须是字符串`);
      }
    }
  }

  const activeName = typeof config.llm.activeProvider === 'string'
    ? config.llm.activeProvider.trim()
    : '';
  if (!activeName) {
    addError('llm.activeProvider 必须填写一个供应商名称');
  } else if (!config.llm.providers?.[activeName]) {
    addError(`llm.activeProvider 指向的 "${activeName}" 不存在于 llm.providers`);
  } else {
    config.llm.activeProvider = activeName;
    const activeProvider = config.llm.providers[activeName];
    if (isPlainObject(activeProvider)) {
      const requiresKey = activeProvider.requiresApiKey === true ||
        (activeProvider.requiresApiKey === undefined &&
          ['anthropic', 'gemini'].includes(activeProvider.type));
      if (requiresKey && !describeApiKey(activeProvider, env).configured) {
        addWarning(
          `当前模型 ${activeName} 需要 API Key，但尚未在配置或环境变量 ${activeProvider.apiKeyEnv || '（未指定）'} 中找到`,
        );
      }
    }
  }

  if (!isPlainObject(config.network) || !isPlainObject(config.network.proxy)) {
    addError('network.proxy 必须是对象');
  } else {
    const proxy = config.network.proxy;
    if (!['direct', 'system', 'manual'].includes(proxy.mode)) {
      addError('network.proxy.mode 必须是 direct、system 或 manual');
    }
    for (const key of ['url', 'bypass', 'username', 'password', 'usernameEnv', 'passwordEnv']) {
      if (proxy[key] !== undefined && typeof proxy[key] !== 'string') {
        addError(`network.proxy.${key} 必须是字符串`);
      }
    }
    for (const key of ['usernameEnv', 'passwordEnv']) {
      if (proxy[key] && !ENV_NAME_RE.test(proxy[key])) {
        addError(`network.proxy.${key} 不是合法的环境变量名`);
      }
    }
    if (proxy.mode === 'manual') {
      try {
        parseProxySettings(proxy, env);
      } catch (error) {
        addError(error.message);
      }
    }
  }

  const voice = config.voice;
  if (!isPlainObject(voice) || !isPlainObject(voice.input) || !isPlainObject(voice.output)) {
    addError('voice.input 和 voice.output 必须是对象');
  } else {
    if (typeof voice.enabled !== 'boolean') addError('voice.enabled 必须是 true 或 false');
    for (const [kind, section] of [['input', voice.input], ['output', voice.output]]) {
      if (typeof section.enabled !== 'boolean') {
        addError(`voice.${kind}.enabled 必须是 true 或 false`);
      }
      if (typeof section.provider !== 'string') {
        addError(`voice.${kind}.provider 必须是字符串`);
      }
    }
    if (voice.enabled || voice.input.provider !== 'disabled' || voice.output.provider !== 'disabled') {
      addWarning(`${RESERVED_VOICE_REASON}；修改 voice 配置不会在 v0.1 中启用麦克风或语音播放`);
    }
  }

  return { errors, warnings };
}

function inspectConfigWarnings(config, assets) {
  const warnings = [];
  if (!assets.animationsDirExists) {
    warnings.push(`动画目录不存在：${assets.animationsDir}`);
  }
  for (const state of ANIMATION_STATES) {
    const item = assets.animations[state];
    if (item.configured && !item.exists) {
      warnings.push(`动画 ${state} 的文件不存在：${item.file}`);
    }
  }
  if (!assets.fallbackExists) {
    warnings.push(`备用形象图片不存在：${assets.fallbackImage || '（未配置）'}`);
  }
  return warnings;
}

function redactUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function providerView(name, provider, env) {
  return {
    name,
    displayName: provider.displayName || name,
    type: provider.type,
    model: provider.model,
    endpoint: redactUrl(provider.baseUrl),
    requiresApiKey: provider.requiresApiKey === true ||
      (provider.requiresApiKey === undefined && ['anthropic', 'gemini'].includes(provider.type)),
    key: describeApiKey(provider, env),
  };
}

function parseConfigText(text, { configPath, appPath, env = process.env }) {
  let raw;
  try {
    raw = YAML.parse(text, { prettyErrors: true });
  } catch (error) {
    const line = error?.linePos?.[0]?.line;
    const message = `${line ? `第 ${line} 行：` : ''}${error.message}`;
    throw new ConfigError(`YAML 语法错误\n${message}`, {
      errors: [message],
      cause: error,
    });
  }

  if (!isPlainObject(raw)) {
    throw new ConfigError('配置文件顶层必须是一个 YAML 对象', {
      errors: ['配置文件顶层必须是一个 YAML 对象'],
    });
  }

  const defaults = createDefaults();
  const merged = deepMerge(defaults, raw);
  const normalizedProviders = {};
  if (isPlainObject(raw.llm?.providers)) {
    for (const [name, provider] of Object.entries(raw.llm.providers)) {
      if (!isSafeKey(name)) continue;
      if (isPlainObject(provider)) {
        const copy = { ...provider };
        if (typeof copy.type === 'string' && PROVIDER_TYPE_ALIASES[copy.type.trim()]) {
          copy.type = PROVIDER_TYPE_ALIASES[copy.type.trim()];
        }
        normalizedProviders[name] = copy;
      } else {
        normalizedProviders[name] = provider;
      }
    }
  }
  merged.llm.providers = normalizedProviders;
  if (typeof merged.llm.activeProvider === 'string') {
    merged.llm.activeProvider = merged.llm.activeProvider.trim();
  }

  const validation = validateConfig(merged, { env });
  const assets = inspectAssets(merged, { appPath, configPath });
  const warnings = [...validation.warnings, ...inspectConfigWarnings(merged, assets)];

  if (validation.errors.length) {
    throw new ConfigError('配置文件校验失败', {
      errors: validation.errors,
      warnings,
    });
  }

  const activeName = merged.llm.activeProvider;
  const activeProvider = merged.llm.providers[activeName];
  const providerMeta = providerView(activeName, activeProvider, env);

  return {
    config: merged,
    configPath,
    configDir: path.dirname(configPath),
    rawText: text,
    hash: crypto.createHash('sha256').update(text).digest('hex'),
    errors: [],
    warnings,
    assets,
    activeProvider,
    providerMeta,
    voice: {
      inputProvider: merged.voice.input.provider,
      outputProvider: merged.voice.output.provider,
    },
  };
}

function loadConfigFile(configPath, { appPath, env = process.env }) {
  const text = readConfigText(configPath);
  return parseConfigText(text, { configPath, appPath, env });
}

function saveConfigText(text, { configPath, appPath, env = process.env }) {
  const loaded = parseConfigText(text, { configPath, appPath, env });
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.config-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tempPath, text, 'utf8');
    fs.renameSync(tempPath, configPath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup failures.
    }
    throw new ConfigError(`保存配置失败：${error.message}`, {
      errors: [`保存配置失败：${error.message}`],
      cause: error,
    });
  }
  return loaded;
}

function createFallbackLoadedConfig({ configPath, appPath, errors = [], warnings = [] }) {
  const config = createDefaults();
  config.llm.providers = {};
  config.llm.activeProvider = '';
  const assets = inspectAssets(config, { appPath, configPath });
  return {
    config,
    configPath,
    configDir: path.dirname(configPath),
    rawText: '',
    hash: '',
    errors,
    warnings: [...warnings, ...inspectConfigWarnings(config, assets)],
    assets,
    activeProvider: null,
    providerMeta: null,
    voice: {
      inputProvider: config.voice.input.provider,
      outputProvider: config.voice.output.provider,
    },
  };
}

function animationPublicView(assets) {
  const result = {};
  for (const state of ANIMATION_STATES) {
    const item = assets.animations[state];
    result[state] = item.exists
      ? {
          exists: true,
          url: `${pathToFileURL(item.file).href}?v=${Math.round(item.mtimeMs)}`,
        }
      : { exists: false, url: null };
  }
  return result;
}

function buildConfigStatus(loaded, configPath, { ok, errors, warnings } = {}) {
  const resolvedErrors = errors ?? loaded.errors ?? [];
  const resolvedWarnings = warnings ?? loaded.warnings ?? [];
  return {
    ok: ok ?? resolvedErrors.length === 0,
    path: configPath,
    errors: resolvedErrors,
    warnings: resolvedWarnings,
  };
}

function toPublicConfig(loaded, {
  revision,
  configStatus,
  voiceStatus,
  appVersion = '',
  proxyStatus = null,
  env = process.env,
}) {
  const config = loaded.config;
  const provider = loaded.providerMeta ?? {
    name: '',
    displayName: '未配置',
    type: '',
    model: '',
    endpoint: '',
  };
  const assets = loaded.assets;
  const animations = animationPublicView(assets);
  const idleUrl = animations.idle?.url || null;
  const fallbackUrl = assets.fallbackExists
    ? `${pathToFileURL(assets.fallbackImage).href}?v=${Math.round(assets.fallbackMtimeMs)}`
    : null;

  return {
    revision,
    appVersion,
    persona: {
      name: config.persona.name,
      greeting: config.persona.greeting,
      inputPlaceholder: config.persona.inputPlaceholder,
      thinkingText: config.persona.thinkingText,
      errorText: config.persona.errorText,
      voiceReservedText: config.persona.voiceReservedText,
    },
    appearance: {
      accentColor: config.appearance.accentColor,
      bubbleDurationMs: config.appearance.bubbleDurationMs,
      bubbleMaxChars: config.appearance.bubbleMaxChars,
      showReplyBubble: config.appearance.showReplyBubble,
      animations,
      idleUrl,
      fallbackUrl,
    },
    chat: {
      maxInputChars: config.chat.maxInputChars,
    },
    window: {
      closeChatOnEscape: config.window.closeChatOnEscape,
      openChatOnStart: config.window.openChatOnStart,
    },
    provider,
    network: {
      proxy: proxyStatus ?? describeProxySettings(config.network.proxy, env),
    },
    voice: voiceStatus,
    config: buildConfigStatus(loaded, loaded.configPath, configStatus),
  };
}

function toSettingsMeta(loaded, {
  configPath,
  configStatus,
  voiceStatus,
  appVersion = '',
  env = process.env,
  proxyStatus = null,
}) {
  const config = loaded.config;
  const providers = Object.entries(config.llm.providers).map(([name, provider]) =>
    providerView(name, provider, env));
  const animations = ANIMATION_STATES.map((state) => {
    const item = loaded.assets.animations[state];
    return {
      state,
      configured: item.configured,
      file: item.file,
      exists: item.exists,
      size: item.size,
    };
  });

  return {
    appVersion,
    configPath,
    configDir: loaded.configDir,
    configStatus: buildConfigStatus(loaded, configPath, configStatus),
    activeProvider: loaded.providerMeta,
    providers,
    proxy: proxyStatus ?? describeProxySettings(config.network.proxy, env),
    animationsDir: loaded.assets.animationsDir,
    animationsDirExists: loaded.assets.animationsDirExists,
    animations,
    voice: voiceStatus,
    personaName: config.persona.name,
  };
}

module.exports = {
  ConfigError,
  animationPublicView,
  buildConfigStatus,
  createFallbackLoadedConfig,
  loadConfigFile,
  parseConfigText,
  readConfigText,
  redactUrl,
  resolveConfigPath,
  saveConfigText,
  toPublicConfig,
  toSettingsMeta,
};
