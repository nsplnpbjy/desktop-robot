'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { loadConfigFile } = require('../src/main/config');

const root = path.resolve(__dirname, '..');
const requiredPaths = [
  'package.json',
  'config/config.example.yaml',
  'launch.ps1',
  'src/main/index.js',
  'src/main/config.js',
  'src/main/llm/index.js',
  'src/main/voice.js',
  'src/preload/index.js',
  'scripts/start.js',
  'src/renderer/pet/index.html',
  'src/renderer/chat/index.html',
  'src/renderer/settings/index.html',
  'assets/icons/robot.png',
  'assets/icons/avatar.png',
  'assets/icons/tray.png',
  'assets/icons/icon.png',
  'assets/icons/app.ico',
];

const animationStates = ['idle', 'thinking', 'talking', 'happy', 'error', 'listening'];

let failed = false;

function fail(message) {
  failed = true;
  console.error(`  ✗ ${message}`);
}

function pass(message) {
  console.log(`  ✓ ${message}`);
}

console.log('Desktop Robot project check\n');

console.log('Files');
for (const relative of requiredPaths) {
  const file = path.join(root, relative);
  if (fs.existsSync(file)) pass(relative);
  else fail(`missing ${relative}`);
}

console.log('\nAnimations');
for (const state of animationStates) {
  const file = path.join(root, 'assets', 'animations', `${state}.gif`);
  if (!fs.existsSync(file)) {
    fail(`missing assets/animations/${state}.gif`);
    continue;
  }
  const size = fs.statSync(file).size;
  if (size < 1024) fail(`assets/animations/${state}.gif is suspiciously small (${size} bytes)`);
  else pass(`${state}.gif (${(size / 1024).toFixed(0)} KiB)`);
}

console.log('\nConfiguration');
try {
  const localConfig = path.join(root, 'config', 'config.yaml');
  const exampleConfig = path.join(root, 'config', 'config.example.yaml');
  const configFile = fs.existsSync(localConfig) ? localConfig : exampleConfig;
  const loaded = loadConfigFile(configFile, {
    appPath: root,
    env: process.env,
  });
  pass(`valid YAML (${path.basename(configFile)}) · active provider: ${loaded.providerMeta.name} (${loaded.providerMeta.model})`);
  pass(`proxy: ${loaded.config.network.proxy.mode}`);
  if (loaded.warnings.length) {
    console.log('  ! warnings:');
    for (const warning of loaded.warnings) console.log(`    - ${warning}`);
  } else {
    pass('no configuration warnings');
  }
  if (!loaded.config.voice.enabled) {
    pass('voice is disabled and reserved for a future version');
  }
} catch (error) {
  fail(`config failed to load: ${error.errors?.join('; ') || error.message}`);
}

console.log('\nDesktop');
if (process.platform === 'win32') {
  console.log('  · Windows detected; tray uses assets/icons/tray.png');
} else {
  console.log(`  · ${process.platform}; packaging has only been smoke-tested on Windows`);
}

if (failed) {
  console.error('\nProject check failed.');
  process.exitCode = 1;
} else {
  console.log('\nProject check passed. Run `npm start` to launch the companion.');
}
