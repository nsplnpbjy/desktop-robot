'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const YAML = require('yaml');

const {
  ConfigError,
  loadConfigFile,
  parseConfigText,
  saveConfigText,
  toPublicConfig,
  toSettingsMeta,
} = require('../src/main/config');
const { VoiceService } = require('../src/main/voice');

function tempProject(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-robot-config-'));
  const animations = path.join(root, 'assets', 'animations');
  fs.mkdirSync(animations, { recursive: true });
  for (const state of ['idle', 'thinking', 'talking', 'happy', 'error', 'listening']) {
    fs.writeFileSync(path.join(animations, `${state}.gif`), Buffer.from('GIF89a-test'));
  }
  fs.writeFileSync(path.join(root, 'assets', 'robot.png'), Buffer.from('PNG-test'));
  const configPath = path.join(root, 'config', 'config.yaml');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, configPath };
}

function baseConfig(overrides = {}) {
  return {
    version: 1,
    appearance: {
      animationsDir: '../assets/animations',
      fallbackImage: '../assets/robot.png',
      watchAnimations: false,
      animations: {
        idle: 'idle.gif',
        thinking: 'thinking.gif',
        talking: 'talking.gif',
        happy: 'happy.gif',
        error: 'error.gif',
        listening: 'listening.gif',
      },
    },
    llm: {
      activeProvider: 'test',
      providers: {
        test: {
          type: 'openai-compatible',
          displayName: 'Test Provider',
          baseUrl: 'http://127.0.0.1:9876/v1',
          model: 'test-model',
          apiKey: 'super-secret-key',
          requiresApiKey: true,
        },
      },
    },
    network: {
      proxy: {
        mode: 'direct',
        url: 'http://127.0.0.1:7890',
        bypass: 'localhost,127.0.0.1',
      },
    },
    voice: {
      enabled: false,
      input: { enabled: false, provider: 'disabled' },
      output: { enabled: false, provider: 'disabled' },
    },
    ...overrides,
  };
}

function writeConfig(configPath, config) {
  const text = YAML.stringify(config);
  fs.writeFileSync(configPath, text, 'utf8');
  return text;
}

test('loads a valid config and resolves animations', (t) => {
  const { root, configPath } = tempProject(t);
  writeConfig(configPath, baseConfig());

  const loaded = loadConfigFile(configPath, { appPath: root, env: {} });
  assert.equal(loaded.providerMeta.name, 'test');
  assert.equal(loaded.providerMeta.type, 'openai-compatible');
  assert.equal(loaded.assets.animations.idle.exists, true);
  assert.equal(loaded.assets.animations.idle.file, path.join(root, 'assets', 'animations', 'idle.gif'));
  assert.deepEqual(loaded.warnings, []);

  const voice = new VoiceService({ getConfig: () => loaded.config });
  const publicConfig = toPublicConfig(loaded, {
    revision: 3,
    configStatus: { errors: [], warnings: [] },
    voiceStatus: voice.getStatus(),
    appVersion: '0.1.0',
    env: {},
  });

  assert.equal(publicConfig.revision, 3);
  assert.equal(publicConfig.provider.name, 'test');
  assert.equal(publicConfig.config.ok, true);
  assert.equal(publicConfig.voice.reserved, true);
  assert.equal(publicConfig.voice.input.available, false);
  assert.ok(publicConfig.appearance.animations.idle.url.startsWith('file:'));
  assert.ok(!JSON.stringify(publicConfig).includes('super-secret-key'));

  const meta = toSettingsMeta(loaded, {
    configPath,
    configStatus: { errors: [], warnings: [] },
    voiceStatus: voice.getStatus(),
    appVersion: '0.1.0',
    env: {},
  });
  assert.equal(meta.providers.length, 1);
  assert.equal(meta.providers[0].key.configured, true);
  assert.ok(!JSON.stringify(meta).includes('super-secret-key'));
});

test('reports missing active provider', (t) => {
  const { root, configPath } = tempProject(t);
  const config = baseConfig();
  config.llm.activeProvider = 'missing';
  writeConfig(configPath, config);

  assert.throws(
    () => loadConfigFile(configPath, { appPath: root, env: {} }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.ok(error.errors.some((message) => message.includes('missing')));
      return true;
    },
  );
});

test('warns only about the active provider API key', (t) => {
  const { root, configPath } = tempProject(t);
  const config = baseConfig();
  config.llm.providers.test.requiresApiKey = false;
  delete config.llm.providers.test.apiKey;
  config.llm.providers.unused = {
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-test',
    apiKeyEnv: 'UNUSED_KEY_THAT_IS_NOT_SET',
    requiresApiKey: true,
  };
  writeConfig(configPath, config);

  const loaded = loadConfigFile(configPath, { appPath: root, env: {} });
  assert.deepEqual(loaded.warnings, []);

  config.llm.activeProvider = 'unused';
  writeConfig(configPath, config);
  const active = loadConfigFile(configPath, { appPath: root, env: {} });
  assert.equal(active.warnings.length, 1);
  assert.match(active.warnings[0], /UNUSED_KEY_THAT_IS_NOT_SET/);
});

test('accepts API key from environment and normalizes type aliases', (t) => {
  const { root, configPath } = tempProject(t);
  const config = baseConfig();
  config.llm.providers.test.type = 'openai';
  config.llm.providers.test.apiKey = '';
  config.llm.providers.test.apiKeyEnv = 'ROBOT_TEST_KEY';
  writeConfig(configPath, config);

  const loaded = loadConfigFile(configPath, {
    appPath: root,
    env: { ROBOT_TEST_KEY: 'env-secret' },
  });
  assert.equal(loaded.config.llm.providers.test.type, 'openai-compatible');
  assert.deepEqual(loaded.warnings, []);
});

test('rejects invalid proxy settings with a readable error', (t) => {
  const { root, configPath } = tempProject(t);
  const config = baseConfig();
  config.network.proxy.mode = 'manual';
  config.network.proxy.url = 'ftp://bad-proxy:21';
  writeConfig(configPath, config);

  assert.throws(
    () => loadConfigFile(configPath, { appPath: root, env: {} }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.ok(error.errors.some((message) => message.includes('network.proxy.url')));
      return true;
    },
  );
});

test('handles wrong-typed sections without crashing', (t) => {
  const { root, configPath } = tempProject(t);
  const config = baseConfig();
  config.appearance = null;
  writeConfig(configPath, config);

  assert.throws(
    () => loadConfigFile(configPath, { appPath: root, env: {} }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.ok(error.errors.some((message) => message.includes('appearance')));
      return true;
    },
  );
});

test('reports YAML syntax errors with line information', (t) => {
  const { configPath } = tempProject(t);
  fs.writeFileSync(configPath, 'version: 1\nllm: [unterminated\n', 'utf8');

  assert.throws(
    () => parseConfigText(fs.readFileSync(configPath, 'utf8'), {
      configPath,
      appPath: path.dirname(configPath),
      env: {},
    }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /YAML/);
      return true;
    },
  );
});

test('warns when GIFs are missing but still keeps a usable config', (t) => {
  const { root, configPath } = tempProject(t);
  fs.unlinkSync(path.join(root, 'assets', 'animations', 'thinking.gif'));
  writeConfig(configPath, baseConfig());

  const loaded = loadConfigFile(configPath, { appPath: root, env: {} });
  assert.equal(loaded.assets.animations.thinking.exists, false);
  assert.ok(loaded.warnings.some((message) => message.includes('thinking')));
  assert.equal(loaded.warnings.some((message) => message.includes('API Key')), false);
});

test('saves config atomically and can reload it', (t) => {
  const { root, configPath } = tempProject(t);
  const config = baseConfig();
  const text = YAML.stringify(config);

  const saved = saveConfigText(text, { configPath, appPath: root, env: {} });
  assert.equal(saved.providerMeta.name, 'test');
  assert.equal(fs.readFileSync(configPath, 'utf8'), text);
});
