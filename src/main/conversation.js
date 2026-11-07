'use strict';

const fs = require('node:fs');
const path = require('node:path');

function sanitizeContent(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

class ConversationStore {
  constructor({ maxMessages = 24, persist = false, persistPath = '', onWarning = null } = {}) {
    this.maxMessages = Math.max(2, Number(maxMessages) || 24);
    this.persist = Boolean(persist);
    this.persistPath = persistPath || '';
    this.onWarning = onWarning;
    this.messages = [];
    this.load();
  }

  warn(message, error) {
    if (typeof this.onWarning === 'function') {
      this.onWarning(message, error);
    }
  }

  load() {
    if (!this.persist || !this.persistPath) return;
    try {
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed?.messages;
      if (!Array.isArray(list)) return;
      this.messages = list
        .filter((message) =>
          message &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string' &&
          message.content.trim())
        .map((message) => ({ role: message.role, content: message.content.trim() }));
      this.trim();
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.warn('历史对话读取失败，将从空对话开始', error);
      }
    }
  }

  setMaxMessages(value) {
    const next = Math.max(2, Number(value) || this.maxMessages);
    if (next === this.maxMessages) return;
    this.maxMessages = next;
    this.trim();
    this.save();
  }

  setPersistence(enabled, persistPath = this.persistPath) {
    this.persist = Boolean(enabled);
    if (persistPath) this.persistPath = persistPath;
    if (this.persist) this.save();
  }

  trim() {
    while (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }
    while (this.messages.length && this.messages[0].role !== 'user') {
      this.messages.shift();
    }
  }

  add(role, content) {
    if (role !== 'user' && role !== 'assistant') return;
    const trimmed = sanitizeContent(content);
    if (!trimmed) return;
    this.messages.push({ role, content: trimmed });
    this.trim();
    this.save();
  }

  clear() {
    this.messages = [];
    if (!this.persistPath) return;
    try {
      fs.unlinkSync(this.persistPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.warn('清空历史对话文件失败', error);
      }
    }
  }

  getMessages() {
    return this.messages.map((message) => ({ ...message }));
  }

  get size() {
    return this.messages.length;
  }

  save() {
    if (!this.persist || !this.persistPath) return;
    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      const temp = `${this.persistPath}.${process.pid}.tmp`;
      fs.writeFileSync(
        temp,
        JSON.stringify({ version: 1, messages: this.messages }, null, 2),
        'utf8',
      );
      fs.renameSync(temp, this.persistPath);
    } catch (error) {
      this.warn('历史对话保存失败', error);
    }
  }
}

module.exports = {
  ConversationStore,
};
