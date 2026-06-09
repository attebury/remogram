import { ERROR_CODES, forgeError } from './contracts/errors.js';
import { readStreamCapped } from './caps.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...options, signal });
}

export async function fetchJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const res = await fetchWithTimeout(url, options, timeoutMs);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw Object.assign(new Error('Unparseable JSON from provider'), {
      forgeError: forgeError(ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT, 'Provider returned invalid JSON'),
      status: res.status,
    });
  }
  if (!res.ok) {
    const message = body?.message || body?.error || res.statusText || 'API error';
    throw Object.assign(new Error(message), {
      forgeError: forgeError(ERROR_CODES.API_ERROR, message, res.status),
      status: res.status,
    });
  }
  return body;
}

export async function fetchTextCapped(url, options = {}, maxBytes) {
  const res = await fetchWithTimeout(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw Object.assign(new Error(text), {
      forgeError: forgeError(ERROR_CODES.API_ERROR, text, res.status),
      status: res.status,
    });
  }
  if (!res.body) return { text: '', truncated: false, bytes: 0 };
  const capped = await readStreamCapped(res.body, maxBytes);
  if (capped.truncated) {
    throw Object.assign(new Error('Provider output exceeded cap'), {
      forgeError: forgeError(ERROR_CODES.OVERSIZED_RAW_OUTPUT, 'Provider response exceeded byte cap'),
    });
  }
  return capped;
}
