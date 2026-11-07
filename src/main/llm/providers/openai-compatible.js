'use strict';

const { LlmError } = require('../errors');
const {
  joinEndpoint,
  normalizeHeaderObject,
  requestJson,
  setHeaderIfAbsent,
} = require('../http');
const { toOpenAiMessages } = require('../messages');

function extractContent(message) {
  if (!message || typeof message !== 'object') return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          if (typeof part.text === 'string') return part.text;
          if (typeof part.content === 'string') return part.content;
        }
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  return '';
}

async function requestOpenAiCompatible({
  provider,
  providerName,
  apiKey,
  messages,
  systemPrompt,
  settings,
  fetchImpl,
}) {
  const label = provider.displayName || providerName || 'OpenAI 兼容服务';
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...normalizeHeaderObject(provider.headers),
  };
  setHeaderIfAbsent(headers, 'Authorization', apiKey ? `Bearer ${apiKey}` : '');

  if (provider.type === 'openclaw') {
    setHeaderIfAbsent(headers, 'x-openclaw-agent-id', provider.agentId || '');
  }

  const maxTokensParam = provider.maxTokensParam || 'max_tokens';
  const body = {
    ...(provider.extraBody && typeof provider.extraBody === 'object' ? provider.extraBody : {}),
    model: provider.model,
    messages: toOpenAiMessages(systemPrompt, messages),
    temperature: settings.temperature,
    [maxTokensParam]: settings.maxOutputTokens,
    stream: false,
  };
  if (provider.type === 'openclaw' && provider.sessionUser) {
    body.user = provider.sessionUser;
  }

  const url = joinEndpoint(provider.baseUrl, '/chat/completions');
  const { data } = await requestJson({
    fetchImpl,
    url,
    headers,
    body,
    timeoutMs: settings.timeoutMs,
    providerLabel: label,
  });

  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const content = extractContent(choice?.message);
  if (!content.trim()) {
    const reason = choice?.finish_reason || data.status || '';
    throw new LlmError('EMPTY', `${label} 没有返回文本`, {
      detail: reason ? `finish_reason=${reason}` : 'The response contained no message.content text.',
    });
  }

  return {
    text: content.trim(),
    model: data.model || provider.model,
  };
}

module.exports = {
  extractContent,
  requestOpenAiCompatible,
};
