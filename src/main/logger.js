'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

let threshold = LEVELS.info;
let stream = null;
let logFilePath = '';

function safeMeta(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const copy = { ...meta };
  for (const key of Object.keys(copy)) {
    if (/key|secret|token|password|authorization/i.test(key)) {
      copy[key] = copy[key] ? '[redacted]' : copy[key];
    }
  }
  return copy;
}

function write(level, message, meta) {
  if ((LEVELS[level] ?? 20) < threshold) return;
  const lineMeta = meta === undefined ? '' : ` ${JSON.stringify(safeMeta(meta))}`;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${lineMeta}`;

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  if (stream) {
    try {
      stream.write(`${line}\n`);
    } catch {
      // File logging must never crash the app.
    }
  }
}

function initLogger({ dir, level = 'info', file = true }) {
  threshold = LEVELS[String(level)] ?? LEVELS.info;
  if (!file) return;

  try {
    fs.mkdirSync(dir, { recursive: true });
    logFilePath = path.join(dir, 'desktop-robot.log');
    try {
      const stat = fs.statSync(logFilePath);
      if (stat.size > 2 * 1024 * 1024) {
        fs.renameSync(logFilePath, `${logFilePath}.1`);
      }
    } catch {
      // No log file yet, or it cannot be rotated. Either is fine.
    }
    stream = fs.createWriteStream(logFilePath, { flags: 'a' });
    stream.on('error', () => {
      stream = null;
    });
  } catch (error) {
    console.warn(`File logging disabled: ${error.message}`);
    stream = null;
  }
}

function closeLogger() {
  if (stream) {
    stream.end();
    stream = null;
  }
}

module.exports = {
  closeLogger,
  debug: (message, meta) => write('debug', message, meta),
  error: (message, meta) => write('error', message, meta),
  getLogFilePath: () => logFilePath,
  info: (message, meta) => write('info', message, meta),
  initLogger,
  warn: (message, meta) => write('warn', message, meta),
};
