#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const electron = require('electron');
const root = path.resolve(__dirname, '..');
const runtimeDir = process.env.DESKTOP_ROBOT_USER_DATA || path.join(root, '.runtime');
fs.mkdirSync(runtimeDir, { recursive: true });

const env = {
  ...process.env,
  DESKTOP_ROBOT_USER_DATA: runtimeDir,
};
delete env.ELECTRON_RUN_AS_NODE;

const args = [];
if (process.platform === 'win32') {
  // Required on this Windows host because Chromium's sandbox cannot initialize
  // inside the restricted desktop environment. The app only renders local,
  // trusted content with contextIsolation and a strict CSP.
  args.push('--no-sandbox', '--disable-gpu');
}
args.push(root);

const child = spawn(electron, args, {
  cwd: root,
  env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`Could not launch Electron: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
