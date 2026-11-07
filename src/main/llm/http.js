'use strict';

const {
  LlmError,
  httpErrorFor,
  networkErrorFor,
  sanitizeDetail,
} = require('./errors');

function joinEndpoint(baseUrl, suffix) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  const normalizedSuffix = suffix.startsWith('/') ? suffix : `/${suffix}`;
  if (base.endsWith(normalizedSuffix)) return base;
  return `${base}${normalizedSuffix}`;
}

function extractErrorDetail(data, rawText) {
  if (data && typeof data === 'object') {
    const candidates = [
      data.error?.message,
      data.error?.error?.message,
      typeof data.error === 'string' ? data.error : '',
      data.message,
      data.detail,
      data.promptFeedback?.blockReason,
      data.candidates?.[0]?.finishReason,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return sanitizeDetail(candidate);
      }
    }
  }
  if (rawText) {
    const trimmed = rawText.trim();
    return sanitizeDetail(trimmed.slice(0, 500));
  }
  return '';
}

function classifyFetchFailure(error, timedOut, timeoutMs) {
  if (timedOut) {
    return new LlmError('TIMEOUT', `请求超时（${Math.round(timeoutMs / 1000)} 秒）`, {
      detail: 'The request was aborted after the configured timeout.',
    });
  }
  return networkErrorFor(error);
}

/**
 * Small JSON request helper used by every provider adapter. It deliberately
 * accepts an injected fetch so tests can run against a local server, while the
 * app passes Electron's net.fetch (which honors the configured proxy).
 */
async function requestJson({
  fetchImpl,
  url,
  method = 'POST',
  headers = {},
  body,
  timeoutMs,
  providerLabel = '模型服务',
}) {
  if (typeof fetchImpl !== 'function') {
    throw new LlmError('CONFIG', '没有可用的网络请求实现', { detail: 'fetchImpl is missing' });
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1000, timeoutMs));

  let response;
  let rawText = '';
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'follow',
      signal: controller.signal,
    });
    rawText = await response.text();
  } catch (error) {
    throw classifyFetchFailure(error, timedOut, timeoutMs);
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const detail = extractErrorDetail(data, rawText);
    throw httpErrorFor(response.status, providerLabel, detail);
  }

  if (!rawText.trim()) {
    throw new LlmError('BAD_RESPONSE', `${providerLabel} 返回了空响应`, {
      detail: 'The HTTP response body was empty.',
      status: response.status,
    });
  }

  if (data === null) {
    throw new LlmError('BAD_RESPONSE', `${providerLabel} 返回的内容不是 JSON`, {
      detail: sanitizeDetail(rawText.slice(0, 500)),
      status: response.status,
    });
  }

  return {
    data,
    status: response.status,
    rawText,
  };
}

function normalizeHeaderObject(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers && typeof headers === 'object' ? headers : {})) {
    if (value === undefined || value === null) continue;
    result[String(key)] = String(value);
  }
  return result;
}

function hasHeader(headers, name) {
  const wanted = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === wanted);
}

function setHeaderIfAbsent(headers, name, value) {
  if (!value || hasHeader(headers, name)) return;
  headers[name] = value;
}

module.exports = {
  extractErrorDetail,
  hasHeader,
  joinEndpoint,
  normalizeHeaderObject,
  requestJson,
  setHeaderIfAbsent,
};
