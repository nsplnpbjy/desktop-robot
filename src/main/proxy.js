'use strict';

const SUPPORTED_PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks4:', 'socks5:']);

function trimValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readEnvSecret(envName, env) {
  const name = trimValue(envName);
  if (!name) return '';
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Turn the YAML proxy section into a small, sanitized runtime description.
 * Credentials embedded in a URL are extracted so they are never passed to
 * Chromium as part of proxyRules and never shown in UI/status output.
 */
function parseProxySettings(proxy = {}, env = process.env) {
  const mode = trimValue(proxy.mode) || 'direct';
  if (!['direct', 'system', 'manual'].includes(mode)) {
    throw new Error(`network.proxy.mode 必须是 direct、system 或 manual，当前为 "${mode}"`);
  }

  if (mode !== 'manual') {
    return {
      mode,
      proxyRules: '',
      bypass: '',
      username: '',
      password: '',
      display: mode === 'system' ? '跟随系统代理' : '不使用代理',
    };
  }

  const rawUrl = trimValue(proxy.url);
  if (!rawUrl) {
    throw new Error('network.proxy.mode 为 manual 时必须填写 network.proxy.url');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('network.proxy.url 不是有效的代理地址');
  }

  if (!SUPPORTED_PROXY_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('network.proxy.url 只支持 http、https、socks4 或 socks5 代理');
  }

  if (!parsed.hostname) {
    throw new Error('network.proxy.url 缺少主机名');
  }

  const urlUsername = decodeURIComponent(parsed.username || '');
  const urlPassword = decodeURIComponent(parsed.password || '');
  parsed.username = '';
  parsed.password = '';

  const username =
    trimValue(proxy.username) ||
    readEnvSecret(proxy.usernameEnv, env) ||
    urlUsername;
  const password =
    trimValue(proxy.password) ||
    readEnvSecret(proxy.passwordEnv, env) ||
    urlPassword;

  // Chromium accepts a bare proxy URL as a rule. Keep the scheme and authority
  // only, stripping any path/query/fragment and embedded credentials.
  const proxyRules = `${parsed.protocol}//${parsed.host}`;
  const bypass = trimValue(proxy.bypass);

  return {
    mode,
    proxyRules,
    bypass,
    username,
    password,
    display: `${parsed.protocol}//${parsed.host}`,
  };
}

function proxyAuthFor(parsed) {
  if (!parsed.username && !parsed.password) return null;
  return { username: parsed.username, password: parsed.password };
}

async function applyProxySettings(session, proxyConfig, env = process.env) {
  const parsed = parseProxySettings(proxyConfig, env);

  if (parsed.mode === 'direct') {
    await session.setProxy({ mode: 'direct' });
  } else if (parsed.mode === 'system') {
    await session.setProxy({ mode: 'system' });
  } else {
    const config = {
      mode: 'fixed_servers',
      proxyRules: parsed.proxyRules,
    };
    if (parsed.bypass) config.proxyBypassRules = parsed.bypass;
    if (parsed.username || parsed.password) {
      // Chromium asks for credentials through app.on('login'); the values are
      // held by the main process only.
      config.proxyBypassRules = parsed.bypass;
    }
    await session.setProxy(config);
  }

  if (typeof session.closeAllConnections === 'function') {
    await session.closeAllConnections();
  }

  return {
    ...parsed,
    auth: proxyAuthFor(parsed),
  };
}

function describeProxySettings(proxy = {}, env = process.env) {
  try {
    const parsed = parseProxySettings(proxy, env);
    return {
      mode: parsed.mode,
      display: parsed.display,
      bypass: parsed.bypass,
      enabled: parsed.mode !== 'direct',
      authenticated: Boolean(parsed.username || parsed.password),
    };
  } catch (error) {
    return {
      mode: trimValue(proxy.mode) || 'direct',
      display: '配置有误',
      bypass: '',
      enabled: false,
      authenticated: false,
      error: error.message,
    };
  }
}

module.exports = {
  applyProxySettings,
  describeProxySettings,
  parseProxySettings,
};
