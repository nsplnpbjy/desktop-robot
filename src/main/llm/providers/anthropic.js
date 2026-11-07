'use strict';

const { LlmError } = require('../errors');
const {
  joinEndpoint,
  normalizeHeaderObject,
  requestJson,
  setHeaderIfAbsent,
} = require('../http');
const { toAnthropicMessages } = require('../messages');

async function requestAnthropic({
  provider,
  providerName,
  apiKey,
  messages,
  systemPrompt,
  settings,
  fetchImpl,
}) {
  const label = provider.displayName || providerName || 'Anthropic';
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'anthropic-version': provider.anthropicVersion || '2023-06-01',
    ...normalizeHeaderObject(provider.headers),
  };
  setHeaderIfAbsent(headers, 'x-api-key', apiKey);

  const body = {
    ...(provider.extraBody && typeof provider.extraBody === 'object' ? provider.extraBody : {}),
    model: provider.model,
    max_tokens: settings.maxOutputTokens,
    temperature: settings.temperature,
    messages: toAnthropicMessages(messages),
  };
  if (typeof systemPrompt === 'string' && systemPrompt.trim()) {
    body.system = systemPrompt.trim();
  }

  const url = joinEndpoint(provider.baseUrl, '/messages');
  const { data } = await requestJson({
    fetchImpl,
    url,
    headers,
    body,
    timeoutMs: settings.timeoutMs,
    providerLabel: label,
  });

  const content = Array.isArray(data.content)
    ? data.content
        .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('')
    : '';

  if (!content.trim()) {
    const reason = data.stop_reason || data.type || '';
    throw new LlmError('EMPTY', `${label} 没有返回文本`, {
      detail: reason ? `stop_reason=${reason}` : 'The response contained no text content blocks.',
    });
  }

  return {
    text: content.trim(),
    model: data.model || provider.model,
  };
}

module.exports = {
  requestAnthropic,
};
