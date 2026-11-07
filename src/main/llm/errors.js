'use strict';

const HINTS = {
  CONFIG: '请检查 config.yaml 中对应的配置项，保存后点击“重新加载配置”。',
  AUTH: '请检查 API Key 是否正确、是否已过期，并确认它属于当前服务商。也可以通过 apiKeyEnv 从环境变量读取。',
  RATE_LIMIT: '请求过于频繁或额度不足，请稍后再试，或检查服务商账户余额。',
  NOT_FOUND: '请检查 baseUrl 和 model 是否正确。如果使用 OpenClaw，/v1/chat/completions 默认是关闭的，需要在 OpenClaw 配置中启用 gateway.http.endpoints.chatCompletions.enabled: true，并重启或重载 Gateway；同时确认地址、端口和 Agent ID 正确。',
  BAD_REQUEST: '请求参数被服务商拒绝。请检查 model、temperature、maxOutputTokens 等设置是否兼容当前模型。',
  NETWORK: '请检查网络连接。如果访问 OpenAI、Claude 等海外服务需要代理，请在 network.proxy 中把 mode 设为 manual 并填写可用代理。OpenClaw 本地网关请确认已启动，且代理 bypass 包含 localhost。',
  PROXY: '代理连接失败。请检查 network.proxy.url、用户名密码和 bypass 设置，并确认代理软件正在运行。',
  TIMEOUT: '请求超时。请检查网络或代理是否稳定，必要时增大 chat.timeoutMs。',
  PROVIDER: '服务商暂时不可用或返回了错误，请稍后再试，并查看设置中的完整错误信息。',
  BAD_RESPONSE: '服务商返回了无法解析的内容。请检查 baseUrl 是否指向正确的 API 端点，或换一个模型重试。',
  EMPTY: '模型没有返回文本。请换一个模型，或降低参数限制后重试。',
  INTERNAL: '发生了未预期的错误，详情已写入本地日志。',
};

function sanitizeDetail(value, maxLength = 800) {
  if (value === undefined || value === null) return '';
  let text = typeof value === 'string' ? value : String(value);
  text = text
    .replace(/\/\/([^/\s:@]+):([^/\s@]+)@/g, '//[redacted]@')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[redacted]')
    .replace(/\b(?:api[_-]?key|token|password)\s*[:=]\s*["']?[^"'\s,}]+/gi, 'secret=[redacted]')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();
  if (text.length > maxLength) text = `${text.slice(0, maxLength)}…`;
  return text;
}

class LlmError extends Error {
  constructor(code, message, { hint, detail = '', status = 0, cause } = {}) {
    super(message, { cause });
    this.name = 'LlmError';
    this.code = code;
    this.detail = sanitizeDetail(detail);
    this.hint = hint || HINTS[code] || HINTS.INTERNAL;
    this.status = status;
  }
}

function httpErrorFor(status, providerLabel, detail) {
  let code = 'PROVIDER';
  let message = `${providerLabel} 返回了 HTTP ${status}`;

  if (status === 401 || status === 403) {
    code = 'AUTH';
    message = `${providerLabel} 认证失败（HTTP ${status}）`;
  } else if (status === 404 || status === 405) {
    code = 'NOT_FOUND';
    message = `${providerLabel} 找不到接口（HTTP ${status}）`;
  } else if (status === 408 || status === 504) {
    code = 'TIMEOUT';
    message = `${providerLabel} 请求超时（HTTP ${status}）`;
  } else if (status === 429) {
    code = 'RATE_LIMIT';
    message = `${providerLabel} 请求被限流（HTTP 429）`;
  } else if (status === 400 || status === 409 || status === 422) {
    code = 'BAD_REQUEST';
    message = `${providerLabel} 拒绝了请求（HTTP ${status}）`;
  } else if (status >= 500) {
    code = 'PROVIDER';
    message = `${providerLabel} 服务异常（HTTP ${status}）`;
  }

  return new LlmError(code, message, {
    hint: HINTS[code],
    detail,
    status,
  });
}

function networkErrorFor(error, { proxy = false } = {}) {
  const causeMessage = error?.cause?.message ? ` (${error.cause.message})` : '';
  const detail = sanitizeDetail(`${error?.message || error}${causeMessage}`);
  const isProxy = proxy || /proxy|tunnel|ERR_PROXY|ERR_TUNNEL|CONNECT/i.test(detail);
  return new LlmError(
    isProxy ? 'PROXY' : 'NETWORK',
    isProxy ? '无法通过代理连接到模型服务' : '无法连接到模型服务',
    {
      hint: isProxy ? HINTS.PROXY : HINTS.NETWORK,
      detail,
    },
  );
}

function publicError(error) {
  if (error instanceof LlmError) {
    return {
      code: error.code,
      message: error.message,
      hint: error.hint,
      detail: error.detail,
      status: error.status || undefined,
    };
  }
  return {
    code: 'INTERNAL',
    message: '发生了未预期的错误',
    hint: HINTS.INTERNAL,
    detail: sanitizeDetail(error?.message || error),
  };
}

module.exports = {
  HINTS,
  LlmError,
  httpErrorFor,
  networkErrorFor,
  publicError,
  sanitizeDetail,
};
