'use strict';

const { LlmError } = require('./errors');
const { normalizeMessages } = require('./messages');
const { requestAnthropic } = require('./providers/anthropic');
const { requestGemini } = require('./providers/gemini');
const { requestOpenAiCompatible } = require('./providers/openai-compatible');
const { resolveApiKey } = require('../secrets');

const ADAPTERS = {
  'openai-compatible': requestOpenAiCompatible,
  openclaw: requestOpenAiCompatible,
  anthropic: requestAnthropic,
  gemini: requestGemini,
};

function effectiveSettings(config, provider, overrides = {}) {
  const chat = config.chat ?? {};
  return {
    temperature: overrides.temperature ?? provider.temperature ?? chat.temperature ?? 0.8,
    maxOutputTokens: overrides.maxOutputTokens ?? provider.maxOutputTokens ?? chat.maxOutputTokens ?? 800,
    timeoutMs: overrides.timeoutMs ?? provider.timeoutMs ?? chat.timeoutMs ?? 90000,
  };
}

function activeProviderFor(config) {
  const providerName = config?.llm?.activeProvider;
  const provider = providerName ? config.llm.providers?.[providerName] : null;
  if (!providerName) {
    throw new LlmError('CONFIG', '尚未选择模型供应商', {
      detail: 'llm.activeProvider is empty.',
    });
  }
  if (!provider) {
    throw new LlmError('CONFIG', `找不到模型供应商 "${providerName}"`, {
      detail: 'llm.activeProvider does not exist in llm.providers.',
    });
  }
  return { providerName, provider };
}

function isApiKeyRequired(provider) {
  if (typeof provider.requiresApiKey === 'boolean') return provider.requiresApiKey;
  return ['anthropic', 'gemini'].includes(provider.type);
}

function resolveProviderApiKey(provider, env) {
  return resolveApiKey(provider, env).value;
}

async function generateReply({
  config,
  messages,
  systemPrompt,
  fetchImpl,
  env = process.env,
  overrides = {},
}) {
  const { providerName, provider } = activeProviderFor(config);
  const adapter = ADAPTERS[provider.type];
  if (!adapter) {
    throw new LlmError('CONFIG', `不支持的模型类型：${provider.type}`, {
      detail: `Provider "${providerName}" has type "${provider.type}".`,
    });
  }

  const apiKey = resolveProviderApiKey(provider, env);
  if (!apiKey && isApiKeyRequired(provider)) {
    throw new LlmError('CONFIG', `模型 "${provider.displayName || providerName}" 缺少 API Key`, {
      detail: `Set llm.providers.${providerName}.apiKey or apiKeyEnv.`,
      hint: '在 config.yaml 中填写 apiKey，或设置 apiKeyEnv 指向的环境变量，然后重新加载配置。',
    });
  }

  const normalized = normalizeMessages(messages);
  if (!normalized.length) {
    throw new LlmError('CONFIG', '没有可发送的对话内容', {
      detail: 'The conversation contains no valid user messages.',
    });
  }

  const settings = effectiveSettings(config, provider, overrides);
  const startedAt = Date.now();

  const result = await adapter({
    provider,
    providerName,
    apiKey,
    messages: normalized,
    systemPrompt,
    settings,
    fetchImpl,
  });

  return {
    ...result,
    providerName,
    providerDisplayName: provider.displayName || providerName,
    providerType: provider.type,
    latencyMs: Date.now() - startedAt,
  };
}

async function testConnection({ config, fetchImpl, env = process.env }) {
  const startedAt = Date.now();
  const result = await generateReply({
    config,
    messages: [{ role: 'user', content: '这是一次连接测试。请只回复：连接成功' }],
    systemPrompt: '你是一个连接测试助手。请简短回复，不要添加解释。',
    fetchImpl,
    env,
    overrides: {
      temperature: 0,
      maxOutputTokens: 32,
      timeoutMs: 45000,
    },
  });

  return {
    text: result.text,
    model: result.model,
    providerName: result.providerName,
    providerDisplayName: result.providerDisplayName,
    providerType: result.providerType,
    latencyMs: Date.now() - startedAt,
  };
}

module.exports = {
  activeProviderFor,
  effectiveSettings,
  generateReply,
  isApiKeyRequired,
  testConnection,
};
