'use strict';

function normalizeMessages(messages) {
  const result = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message.content !== 'string') continue;
    const role = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : '';
    const content = message.content.trim();
    if (!role || !content) continue;

    const previous = result[result.length - 1];
    if (previous && previous.role === role) {
      previous.content = `${previous.content}\n\n${content}`;
    } else {
      result.push({ role, content });
    }
  }

  while (result.length && result[0].role === 'assistant') {
    result.shift();
  }
  return result;
}

function toOpenAiMessages(systemPrompt, messages) {
  const result = [];
  if (typeof systemPrompt === 'string' && systemPrompt.trim()) {
    result.push({ role: 'system', content: systemPrompt.trim() });
  }
  result.push(...normalizeMessages(messages));
  return result;
}

function toAnthropicMessages(messages) {
  return normalizeMessages(messages).map((message) => ({
    role: message.role,
    content: [{ type: 'text', text: message.content }],
  }));
}

function toGeminiContents(messages) {
  return normalizeMessages(messages).map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));
}

module.exports = {
  normalizeMessages,
  toAnthropicMessages,
  toGeminiContents,
  toOpenAiMessages,
};
