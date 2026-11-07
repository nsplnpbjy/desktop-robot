'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { ChatService, cleanReplyPreview } = require('../src/main/chat-service');
const { ConversationStore } = require('../src/main/conversation');

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function makeConfig(overrides = {}) {
  return {
    chat: {
      maxHistoryMessages: 10,
      maxInputChars: 100,
      temperature: 0.5,
      maxOutputTokens: 100,
      timeoutMs: 5000,
    },
    persona: {
      name: '小机',
      systemPrompt: '你是测试助手',
      thinkingText: '思考中',
      errorText: '出错了',
      voiceReservedText: '语音预留',
    },
    appearance: {
      bubbleMaxChars: 60,
      bubbleDurationMs: 3000,
      showReplyBubble: true,
    },
    llm: {
      activeProvider: 'test',
      providers: {
        test: {
          type: 'openai-compatible',
          baseUrl: '',
          model: 'test-model',
          apiKey: 'test-key',
        },
      },
    },
    ...overrides,
  };
}

function makeWindows() {
  const calls = [];
  return {
    calls,
    isChatVisible: () => false,
    setPetState: (state, options = {}) => calls.push({ type: 'pet-state', state, options }),
    showBubble: (text, tone, durationMs) => calls.push({ type: 'bubble', text, tone, durationMs }),
  };
}

function startServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

function readBody(request) {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => resolve(body));
  });
}

function getState(config, status = { errors: [], warnings: [] }) {
  return {
    loaded: {
      config,
      providerMeta: {
        name: 'test',
        displayName: 'Test',
        type: 'openai-compatible',
        model: 'test-model',
      },
    },
    configStatus: status,
  };
}

test('successful send updates conversation, pet state and bubble', async (t) => {
  const { server, baseUrl } = await startServer(async (request, response) => {
    await readBody(request);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: '你好呀，这是回复。' } }] }));
  });
  t.after(() => server.close());

  const config = makeConfig();
  config.llm.providers.test.baseUrl = baseUrl;
  const conversation = new ConversationStore({ maxMessages: 10, persist: false });
  const windows = makeWindows();
  const service = new ChatService({
    getState: () => getState(config),
    conversation,
    windows,
    fetchImpl: fetch,
    logger: silentLogger,
    env: {},
  });

  const result = await service.sendMessage('你好');
  assert.equal(result.ok, true);
  assert.match(result.reply, /你好呀/);
  assert.deepEqual(conversation.getMessages().map((message) => message.role), ['user', 'assistant']);
  assert.ok(windows.calls.some((call) => call.type === 'pet-state' && call.state === 'thinking'));
  assert.ok(windows.calls.some((call) => call.type === 'pet-state' && call.state === 'talking'));
  assert.ok(windows.calls.some((call) => call.type === 'bubble' && call.tone === 'thinking'));
  assert.ok(windows.calls.some((call) => call.type === 'bubble' && call.tone === 'reply'));
  assert.equal(service.busy, false);

  assert.deepEqual(service.notifyReplyFinished(result.turnId), { ok: true });
  assert.ok(windows.calls.some((call) => call.type === 'pet-state' && call.state === 'idle'));
});

test('failed send keeps the user message and reports a structured error', async (t) => {
  const { server, baseUrl } = await startServer(async (request, response) => {
    await readBody(request);
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'bad key' } }));
  });
  t.after(() => server.close());

  const config = makeConfig();
  config.llm.providers.test.baseUrl = baseUrl;
  const conversation = new ConversationStore({ maxMessages: 10, persist: false });
  const windows = makeWindows();
  const service = new ChatService({
    getState: () => getState(config),
    conversation,
    windows,
    fetchImpl: fetch,
    logger: silentLogger,
    env: {},
  });

  const result = await service.sendMessage('不会成功的消息');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'AUTH');
  assert.deepEqual(conversation.getMessages(), [{ role: 'user', content: '不会成功的消息' }]);
  assert.ok(windows.calls.some((call) => call.type === 'pet-state' && call.state === 'error'));
  assert.ok(windows.calls.some((call) => call.type === 'bubble' && call.tone === 'error'));
  assert.equal(service.busy, false);
});

test('invalid config blocks network requests', async () => {
  let fetchCalls = 0;
  const conversation = new ConversationStore({ maxMessages: 10, persist: false });
  const windows = makeWindows();
  const service = new ChatService({
    getState: () => getState(makeConfig(), { errors: ['配置坏了'], warnings: [] }),
    conversation,
    windows,
    fetchImpl: async () => { fetchCalls += 1; throw new Error('must not happen'); },
    logger: silentLogger,
    env: {},
  });

  const result = await service.sendMessage('你好');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CONFIG');
  assert.equal(fetchCalls, 0);
  assert.equal(conversation.size, 0);
});

test('rejects empty and overlong input without touching conversation', async () => {
  const config = makeConfig();
  const conversation = new ConversationStore({ maxMessages: 10, persist: false });
  const windows = makeWindows();
  const service = new ChatService({
    getState: () => getState(config),
    conversation,
    windows,
    fetchImpl: fetch,
    logger: silentLogger,
    env: {},
  });

  assert.equal((await service.sendMessage('   ')).ok, false);
  assert.equal(conversation.size, 0);
  assert.equal((await service.sendMessage('x'.repeat(101))).error.code, 'INPUT_TOO_LONG');
  assert.equal(conversation.size, 0);
});

test('reset is refused while a request is in progress', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { server, baseUrl } = await startServer(async (_request, response) => {
    await gate;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
  t.after(() => server.close());

  const config = makeConfig();
  config.llm.providers.test.baseUrl = baseUrl;
  const conversation = new ConversationStore({ maxMessages: 10, persist: false });
  const service = new ChatService({
    getState: () => getState(config),
    conversation,
    windows: makeWindows(),
    fetchImpl: fetch,
    logger: silentLogger,
    env: {},
  });

  const pending = service.sendMessage('你好');
  await new Promise((resolve) => setTimeout(resolve, 50));
  const reset = await service.resetConversation();
  assert.equal(reset.ok, false);
  assert.equal(reset.error.code, 'BUSY');
  release();
  const result = await pending;
  assert.equal(result.ok, true);
  service.notifyReplyFinished(result.turnId);
});

test('cleanReplyPreview collapses whitespace and truncates', () => {
  assert.equal(cleanReplyPreview('a\n\n b   c', 20), 'a b c');
  assert.equal(cleanReplyPreview('1234567890', 5), '1234…');
});
