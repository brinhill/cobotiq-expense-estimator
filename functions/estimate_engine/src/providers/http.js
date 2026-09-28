'use strict';

class ProviderError extends Error {
  constructor(provider, message, status) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status || null;
  }
}

async function getJson(provider, url, { fetchImpl, headers, timeoutMs = 20000 } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await doFetch(url, { headers, signal: controller.signal });
  } catch (err) {
    throw new ProviderError(provider, err.name === 'AbortError' ? 'request timed out' : err.message);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ProviderError(provider, `HTTP ${res.status}`, res.status);
  try {
    return await res.json();
  } catch {
    throw new ProviderError(provider, 'response was not JSON', res.status);
  }
}

function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  return q.toString();
}

module.exports = { ProviderError, getJson, query };
