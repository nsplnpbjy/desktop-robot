'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { generateReply, testConnection } = require('../src/main/llm');
const { publicError } = require('../src/main/llm/errors');
const { joinEndpoint } = require('../src/main/llm/http');
const { normalizeMessages } = require('../src/main/llm/messages');

function makeConfig(provider, overrides = {}) {
  return {
    chat: {
      temperature: 0.5,
      maxOutputTokens: 120,
      timeoutMs: 5000,
    },
    llm: {
      activeProvider: 'test',
      providers: {
        test: provider,
      },
    },
    ...overrides,
  };
}

function startServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
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

test('OpenAI-compatible provider sends expected request and parses reply', async (t) => {
  let captured;
  const { server, baseUrl } = await startServer(async (request, response) => {
    const body = await readBody(request);
    captured = { url: request.url, headers: request.headers, body: JSON.parse(body) };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      model: 'test-model',
      choices: [{ message: { content: '你好，我是测试回复。' }, finish_reason: 'stop' }],
    }));
  });
  t.after(() => server.close());

  const result = await generateReply({
    config: makeConfig({
      type: 'openai-compatible',
      displayName: 'Test API',
      baseUrl: `${baseUrl}/v1`,
      model: 'test-model',
      apiKey: 'test-secret',
      headers: { 'X-Custom': 'yes' },
    }),
    messages: [
      { role: 'assistant', content: 'this leading assistant is ignored' },
      { role: 'user', content: '你好' },
      { role: 'user', content: '再说一句' },
    ],
    systemPrompt: '你是测试助手',
    fetchImpl: fetch,
    env: {},
  });

  assert.equal(result.text, '你好，我是测试回复。');
  assert.equal(result.providerName, 'test');
  assert.equal(captured.url, '/v1/chat/completions');
  assert.equal(captured.headers.authorization, 'Bearer test-secret');
  assert.equal(captured.headers['x-custom'], 'yes');
  assert.equal(captured.body.model, 'test-model');
  assert.equal(captured.body.messages[0].role, 'system');
  assert.equal(captured.body.messages[1].role, 'user');
  assert.match(captured.body.messages[1].content, /你好/);
  assert.match(captured.body.messages[1].content, /再说一句/);
  assert.equal(captured.body.max_tokens, 120);
});

test('OpenClaw provider sends agent header and optional session user', async (t) => {
  let captured;
  const { server, baseUrl } = await startServer(async (request, response) => {
    captured = { headers: request.headers, body: JSON.parse(await readBody(request)) };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: '收到' } }] }));
  });
  t.after(() => server.close());

  const result = await generateReply({
    config: makeConfig({
      type: 'openclaw',
      displayName: 'OpenClaw',
      baseUrl: `${baseUrl}/v1`,
      model: 'openclaw:main',
      agentId: 'main',
      sessionUser: 'desktop-robot-main',
      apiKey: 'gateway-token',
    }),
    messages: [{ role: 'user', content: 'ping' }],
    systemPrompt: '',
    fetchImpl: fetch,
    env: {},
  });

  assert.equal(result.text, '收到');
  assert.equal(captured.headers['x-openclaw-agent-id'], 'main');
  assert.equal(captured.headers.authorization, 'Bearer gateway-token');
  assert.equal(captured.body.user, 'desktop-robot-main');
});

test('Anthropic provider uses Messages API shape', async (t) => {
  let captured;
  const { server, baseUrl } = await startServer(async (request, response) => {
    captured = { url: request.url, headers: request.headers, body: JSON.parse(await readBody(request)) };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      model: 'claude-test',
      content: [
        { type: 'text', text: '第一段。' },
        { type: 'thinking', thinking: 'hidden' },
        { type: 'text', text: '第二段。' },
      ],
      stop_reason: 'end_turn',
    }));
  });
  t.after(() => server.close());

  const result = await generateReply({
    config: makeConfig({
      type: 'anthropic',
      displayName: 'Claude',
      baseUrl: `${baseUrl}/v1`,
      model: 'claude-test',
      apiKey: 'anthropic-secret',
      anthropicVersion: '2023-06-01',
    }),
    messages: [{ role: 'user', content: '你好' }],
    systemPrompt: '你是测试助手',
    fetchImpl: fetch,
    env: {},
  });

  assert.equal(result.text, '第一段。第二段。');
  assert.equal(captured.url, '/v1/messages');
  assert.equal(captured.headers['x-api-key'], 'anthropic-secret');
  assert.equal(captured.headers['anthropic-version'], '2023-06-01');
  assert.equal(captured.body.system, '你是测试助手');
  assert.deepEqual(captured.body.messages[0], {
    role: 'user',
    content: [{ type: 'text', text: '你好' }],
  });
  assert.equal(captured.body.max_tokens, 120);
});

test('Gemini provider uses generateContent shape', async (t) => {
  let captured;
  const { server, baseUrl } = await startServer(async (request, response) => {
    captured = { url: request.url, headers: request.headers, body: JSON.parse(await readBody(request)) };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      modelVersion: 'gemini-test-001',
      candidates: [{
        content: { role: 'model', parts: [{ text: 'Gemini 回复' }] },
        finishReason: 'STOP',
      }],
    }));
  });
  t.after(() => server.close());

  const result = await generateReply({
    config: makeConfig({
      type: 'gemini',
      displayName: 'Gemini',
      baseUrl: `${baseUrl}/v1beta`,
      model: 'gemini-test',
      apiKey: 'google-secret',
    }),
    messages: [
      { role: 'user', content: '第一句' },
      { role: 'assistant', content: '回答' },
      { role: 'user', content: '第二句' },
    ],
    systemPrompt: '你是测试助手',
    fetchImpl: fetch,
    env: {},
  });

  assert.equal(result.text, 'Gemini 回复');
  assert.equal(captured.url, '/v1beta/models/gemini-test:generateContent');
  assert.equal(captured.headers['x-goog-api-key'], 'google-secret');
  assert.equal(captured.body.systemInstruction.parts[0].text, '你是测试助手');
  assert.equal(captured.body.contents[1].role, 'model');
  assert.equal(captured.body.generationConfig.maxOutputTokens, 120);
});

test('missing API key fails before making a network request', async () => {
  let fetchWasCalled = false;
  await assert.rejects(
    () => generateReply({
      config: makeConfig({
        type: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
        model: 'test-model',
        requiresApiKey: true,
      }),
      messages: [{ role: 'user', content: 'hello' }],
      systemPrompt: '',
      fetchImpl: async () => {
        fetchWasCalled = true;
        throw new Error('should not be called');
      },
      env: {},
    }),
    (error) => {
      assert.equal(error.code, 'CONFIG');
      assert.match(error.message, /API Key/);
      return true;
    },
  );
  assert.equal(fetchWasCalled, false);
});

test('HTTP errors are mapped and secrets are redacted in public errors', async (t) => {
  const { server, baseUrl } = await startServer(async (_request, response) => {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      error: { message: 'Invalid key sk-verysecret12345 for Bearer abc.def.ghi' },
    }));
  });
  t.after(() => server.close());

  await assert.rejects(
    () => generateReply({
      config: makeConfig({
        type: 'openai-compatible',
        baseUrl,
        model: 'test-model',
        apiKey: 'bad',
      }),
      messages: [{ role: 'user', content: 'hello' }],
      systemPrompt: '',
      fetchImpl: fetch,
      env: {},
    }),
    (error) => {
      assert.equal(error.code, 'AUTH');
      assert.equal(error.status, 401);
      const exposed = publicError(error);
      assert.equal(exposed.code, 'AUTH');
      assert.ok(!exposed.detail.includes('verysecret'));
      assert.ok(!/Bearer\s+abc/.test(exposed.detail));
      return true;
    },
  );
});

test('connection test uses a short prompt and reports latency', async (t) => {
  const { server, baseUrl } = await startServer(async (request, response) => {
    const body = JSON.parse(await readBody(request));
    assert.equal(body.messages.at(-1).content.includes('连接测试'), true);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }));
  });
  t.after(() => server.close());

  const result = await testConnection({
    config: makeConfig({
      type: 'openai-compatible',
      baseUrl,
      model: 'test-model',
      apiKey: 'test',
    }),
    fetchImpl: fetch,
    env: {},
  });

  assert.equal(result.text, '连接成功');
  assert.equal(result.providerName, 'test');
  assert.equal(typeof result.latencyMs, 'number');
});

test('normalizeMessages merges consecutive roles and removes leading assistant', () => {
  assert.deepEqual(
    normalizeMessages([
      { role: 'assistant', content: 'leading' },
      { role: 'user', content: 'one' },
      { role: 'user', content: 'two' },
      { role: 'assistant', content: 'answer' },
      { role: 'assistant', content: 'more' },
    ]),
    [
      { role: 'user', content: 'one\n\ntwo' },
      { role: 'assistant', content: 'answer\n\nmore' },
    ],
  );
});

test('joinEndpoint avoids duplicating the endpoint suffix', () => {
  assert.equal(joinEndpoint('https://api.example.com/v1', '/chat/completions'), 'https://api.example.com/v1/chat/completions');
  assert.equal(joinEndpoint('https://api.example.com/v1/chat/completions', '/chat/completions'), 'https://api.example.com/v1/chat/completions');
  assert.equal(joinEndpoint('https://api.example.com/v1/', '/messages'), 'https://api.example.com/v1/messages');
});
