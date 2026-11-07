'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ConversationStore } = require('../src/main/conversation');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-robot-chat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('trims history and always starts with a user message', () => {
  const store = new ConversationStore({ maxMessages: 4, persist: false });
  store.add('assistant', 'leading assistant');
  store.add('user', 'one');
  store.add('assistant', 'two');
  store.add('user', 'three');
  store.add('assistant', 'four');
  assert.deepEqual(store.getMessages().map((message) => message.content), ['one', 'two', 'three', 'four']);

  store.add('user', 'five');
  const messages = store.getMessages();
  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, 'three');
  assert.equal(messages[2].content, 'five');
});

test('persists and restores history when enabled', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'conversation.json');
  const first = new ConversationStore({ maxMessages: 10, persist: true, persistPath: file });
  first.add('user', 'hello');
  first.add('assistant', 'hi');
  assert.equal(fs.existsSync(file), true);

  const second = new ConversationStore({ maxMessages: 10, persist: true, persistPath: file });
  assert.deepEqual(second.getMessages(), [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ]);
  second.clear();
  assert.deepEqual(second.getMessages(), []);
  assert.equal(fs.existsSync(file), false);
});

test('does not read or write history when persistence is off', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'conversation.json');
  fs.writeFileSync(file, JSON.stringify({ messages: [{ role: 'user', content: 'old' }] }));

  const store = new ConversationStore({ maxMessages: 10, persist: false, persistPath: file });
  assert.deepEqual(store.getMessages(), []);
  store.add('user', 'new');
  assert.equal(fs.existsSync(file), true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).messages[0].content, 'old');
});

test('ignores malformed rows while loading persisted history', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'conversation.json');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    messages: [
      { role: 'user', content: 'ok' },
      { role: 'system', content: 'ignored' },
      { role: 'assistant', content: '' },
      { role: 'assistant', content: 'reply' },
    ],
  }));

  const store = new ConversationStore({ maxMessages: 10, persist: true, persistPath: file });
  assert.deepEqual(store.getMessages(), [
    { role: 'user', content: 'ok' },
    { role: 'assistant', content: 'reply' },
  ]);
});
