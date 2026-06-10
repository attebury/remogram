import { ERROR_CODES, forgeError } from './contracts/errors.js';
import { readStreamCapped, DEFAULT_MAX_BYTES, sanitizeField } from './caps.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_JSON_MAX_BYTES = DEFAULT_MAX_BYTES;

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...options, signal, redirect: 'manual' });
}

async function readResponseTextCapped(res, maxBytes) {
  if (!res.body) return '';
  const capped = await readStreamCapped(res.body, maxBytes);
  if (capped.truncated) {
    throw Object.assign(new Error('Provider output exceeded cap'), {
      forgeError: forgeError(ERROR_CODES.OVERSIZED_RAW_OUTPUT, 'Provider response exceeded byte cap'),
      status: res.status,
    });
  }
  return capped.text;
}

export async function fetchJson(
  url,
  options = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_JSON_MAX_BYTES,
) {
  const res = await fetchWithTimeout(url, options, timeoutMs);
  if (res.status >= 300 && res.status < 400) {
    const message = 'HTTP redirect rejected';
    throw Object.assign(new Error(message), {
      forgeError: forgeError(ERROR_CODES.API_ERROR, message, res.status),
      status: res.status,
    });
  }
  const text = await readResponseTextCapped(res, maxBytes);
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
    const raw = body?.message || body?.error || res.statusText || 'API error';
    const message = sanitizeField(raw) || 'API error';
    throw Object.assign(new Error(message), {
      forgeError: forgeError(ERROR_CODES.API_ERROR, message, res.status),
      status: res.status,
    });
  }
  return body;
}

export async function fetchTextCapped(url, options = {}, maxBytes = DEFAULT_MAX_BYTES) {
  const res = await fetchWithTimeout(url, options);
  if (res.status >= 300 && res.status < 400) {
    const message = 'HTTP redirect rejected';
    throw Object.assign(new Error(message), {
      forgeError: forgeError(ERROR_CODES.API_ERROR, message, res.status),
      status: res.status,
    });
  }
  if (!res.ok) {
    const raw = await readResponseTextCapped(res, maxBytes).catch(() => res.statusText);
    const message = sanitizeField(raw) || 'API error';
    throw Object.assign(new Error(message), {
      forgeError: forgeError(ERROR_CODES.API_ERROR, message, res.status),
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
