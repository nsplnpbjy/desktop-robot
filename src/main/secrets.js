'use strict';

/**
 * Resolve an API key without ever logging or returning more information than
 * necessary. Environment variables take precedence over inline values so a
 * config file can safely contain a placeholder while the real key stays local.
 */
function resolveApiKey(provider, env = process.env) {
  const envName = typeof provider?.apiKeyEnv === 'string' ? provider.apiKeyEnv.trim() : '';
  if (envName) {
    const fromEnv = env[envName];
    if (typeof fromEnv === 'string' && fromEnv.trim()) {
      return { value: fromEnv.trim(), source: 'env', envName };
    }
  }

  const inline = typeof provider?.apiKey === 'string' ? provider.apiKey.trim() : '';
  if (inline) {
    return { value: inline, source: 'inline', envName: '' };
  }

  return { value: '', source: 'none', envName };
}

function describeApiKey(provider, env = process.env) {
  const resolved = resolveApiKey(provider, env);
  return {
    configured: Boolean(resolved.value),
    source: resolved.source,
    envName: resolved.envName,
  };
}

module.exports = {
  describeApiKey,
  resolveApiKey,
};
