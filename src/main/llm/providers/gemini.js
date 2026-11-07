'use strict';

const { LlmError } = require('../errors');
const {
  normalizeHeaderObject,
  requestJson,
  setHeaderIfAbsent,
} = require('../http');
const { toGeminiContents } = require('../messages');

function buildGeminiUrl(baseUrl, model) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  const cleanModel = String(model || '').trim().replace(/^models\//, '');
  return `${base}/models/${encodeURIComponent(cleanModel)}:generateContent`;
}

async function requestGemini({
  provider,
  providerName,
  apiKey,
  messages,
  systemPrompt,
  settings,
  fetchImpl,
}) {
  const label = provider.displayName || providerName || 'Gemini';
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...normalizeHeaderObject(provider.headers),
  };
  setHeaderIfAbsent(headers, 'x-goog-api-key', apiKey);

  const body = {
    ...(provider.extraBody && typeof provider.extraBody === 'object' ? provider.extraBody : {}),
    contents: toGeminiContents(messages),
    generationConfig: {
      temperature: settings.temperature,
      maxOutputTokens: settings.maxOutputTokens,
    },
  };
  if (typeof systemPrompt === 'string' && systemPrompt.trim()) {
    body.systemInstruction = {
      parts: [{ text: systemPrompt.trim() }],
    };
  }

  const url = buildGeminiUrl(provider.baseUrl, provider.model);
  const { data } = await requestJson({
    fetchImpl,
    url,
    headers,
    body,
    timeoutMs: settings.timeoutMs,
    providerLabel: label,
  });

  const candidate = Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const content = parts
    .filter((part) => part && part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');

  if (!content.trim()) {
    const reason = candidate?.finishReason || data.promptFeedback?.blockReason || '';
    throw new LlmError('EMPTY', `${label} 没有返回文本`, {
      detail: reason ? `finishReason=${reason}` : 'The response contained no text parts.',
    });
  }

  return {
    text: content.trim(),
    model: data.modelVersion || provider.model,
  };
}

module.exports = {
  buildGeminiUrl,
  requestGemini,
};
