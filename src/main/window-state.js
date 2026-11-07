'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isFinitePoint(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function readWindowState(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (isFinitePoint(data?.pet)) {
      return { pet: { x: Math.round(data.pet.x), y: Math.round(data.pet.y) } };
    }
  } catch {
    // Missing or corrupt state simply means "use the configured start position".
  }
  return null;
}

function writeWindowState(filePath, state) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(temp, filePath);
  } catch {
    // Remembering a window position is a nice-to-have and must never crash.
  }
}

module.exports = {
  readWindowState,
  writeWindowState,
};
