'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyProxySettings,
  describeProxySettings,
  parseProxySettings,
} = require('../src/main/proxy');

test('parses direct and system modes', () => {
  assert.deepEqual(parseProxySettings({ mode: 'direct' }, {}), {
    mode: 'direct',
    proxyRules: '',
    bypass: '',
    username: '',
    password: '',
    display: '不使用代理',
  });
  assert.equal(parseProxySettings({ mode: 'system' }, {}).display, '跟随系统代理');
});

test('parses manual proxy, strips credentials and reads env credentials', () => {
  const parsed = parseProxySettings({
    mode: 'manual',
    url: 'http://embedded-user:embedded-pass@127.0.0.1:7890/path?x=1',
    bypass: 'localhost,127.0.0.1',
    usernameEnv: 'PROXY_USER',
    passwordEnv: 'PROXY_PASS',
  }, {
    PROXY_USER: 'env-user',
    PROXY_PASS: 'env-pass',
  });

  assert.equal(parsed.mode, 'manual');
  assert.equal(parsed.proxyRules, 'http://127.0.0.1:7890');
  assert.equal(parsed.bypass, 'localhost,127.0.0.1');
  assert.equal(parsed.username, 'env-user');
  assert.equal(parsed.password, 'env-pass');
  assert.equal(parsed.display, 'http://127.0.0.1:7890');
  assert.ok(!JSON.stringify(parsed).includes('embedded-pass'));
});

test('supports socks proxies and rejects unsupported protocols', () => {
  const parsed = parseProxySettings({ mode: 'manual', url: 'socks5://127.0.0.1:1080' }, {});
  assert.equal(parsed.proxyRules, 'socks5://127.0.0.1:1080');
  assert.throws(
    () => parseProxySettings({ mode: 'manual', url: 'ftp://127.0.0.1:21' }, {}),
    /只支持/,
  );
  assert.throws(() => parseProxySettings({ mode: 'wat' }, {}), /mode/);
});

test('applies proxy settings to the Electron session abstraction', async () => {
  const calls = [];
  const session = {
    setProxy: async (value) => calls.push(['setProxy', value]),
    closeAllConnections: async () => calls.push(['closeAllConnections']),
  };

  const applied = await applyProxySettings(session, {
    mode: 'manual',
    url: 'http://127.0.0.1:7890',
    bypass: 'localhost',
  }, {});

  assert.equal(applied.proxyRules, 'http://127.0.0.1:7890');
  assert.equal(calls[0][0], 'setProxy');
  assert.deepEqual(calls[0][1], {
    mode: 'fixed_servers',
    proxyRules: 'http://127.0.0.1:7890',
    proxyBypassRules: 'localhost',
  });
  assert.deepEqual(calls[1], ['closeAllConnections']);
});

test('describeProxySettings never exposes credentials', () => {
  const description = describeProxySettings({
    mode: 'manual',
    url: 'http://user:pass@127.0.0.1:7890',
  }, {});
  assert.equal(description.authenticated, true);
  assert.ok(!JSON.stringify(description).includes('user:pass'));
  assert.ok(!description.display.includes('user'));
});
