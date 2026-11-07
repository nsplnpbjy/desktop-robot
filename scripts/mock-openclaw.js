'use strict';

/**
 * Tiny local stand-in for an OpenClaw gateway. It speaks just enough of the
 * OpenAI Chat Completions API to exercise Desktop Robot without any API key.
 *
 * Usage:
 *   npm run mock
 *
 * Then keep llm.activeProvider: openclaw and send a message.
 */

const http = require('node:http');

const port = Number(process.env.MOCK_LLM_PORT || 18789);
const host = '127.0.0.1';

const replies = [
  '我在呢。桌面上的光线刚刚好，适合聊点轻松的东西。',
  '收到。这个想法挺有意思的，我们可以把它拆成一小步一小步来做。',
  '如果我是你的桌面小机器人，我会先把这件事记在便签上，然后陪你一起完成。',
  '嗯，让我想想……我会先检查一下连接，再认真回答你。',
  '今天的能量条还很充足。要不要先休息一下，再继续？',
];

let requestCount = 0;

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Not found' } }));
    return;
  }

  let body;
  try {
    body = await readJson(request);
  } catch {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
    return;
  }

  requestCount += 1;
  const userMessage = [...(body.messages || [])].reverse().find((message) => message.role === 'user');
  const text = userMessage?.content || '';
  const isTest = text.includes('连接测试');
  const reply = isTest
    ? '连接成功'
    : `${replies[requestCount % replies.length]}\n\n（本地模拟 OpenClaw 的回复，模型标记为 ${body.model || 'unknown'}。）`;

  const delay = isTest ? 50 : 900 + Math.round(Math.random() * 500);
  setTimeout(() => {
    if (response.writableEnded) return;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      id: `chatcmpl-mock-${requestCount}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model || 'openclaw:main',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: reply },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }));
  }, delay);
});

server.listen(port, host, () => {
  console.log(`Mock OpenClaw gateway listening on http://${host}:${port}/v1/chat/completions`);
  console.log('Keep config.yaml llm.activeProvider set to "openclaw" and restart Desktop Robot.');
});

function shutdown() {
  console.log('\nMock gateway stopping.');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
