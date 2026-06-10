/**
 * Shared smoke-only forge HTTP helpers (256KB read cap; bodies not persisted).
 */
import { assertForgeReady, loadConfig, readStreamCapped } from '@remogram/core';

export const SMOKE_SIDECAR_MAX_BYTES = 256 * 1024;

export function loadSmokeForgeContext(cwd = process.cwd()) {
  const ready = assertForgeReady(loadConfig(cwd));
  return {
    config: ready.config,
    parsed: ready.parsed,
    cwd: ready.cwd,
    providerId: ready.config.provider,
  };
}

async function readResponseBody(res, maxBytes = SMOKE_SIDECAR_MAX_BYTES) {
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  }
  const { text, bytes, truncated } = await readStreamCapped(res.body, maxBytes);
  return { text, bytes, truncated };
}

export async function measureGet(url, headers = {}) {
  const res = await fetch(url, { headers, redirect: 'error' });
  const { bytes, truncated } = await readResponseBody(res);
  return { bytes, truncated };
}

export async function measurePostJson(url, headers, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'error',
  });
  const { bytes, truncated } = await readResponseBody(res);
  return { bytes, truncated };
}

/** Fetch JSON for sidecar routing; response text is discarded after parsing. */
export async function fetchJsonMeasured(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers, body, redirect: 'error' });
  const { text, bytes, truncated } = await readResponseBody(res);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Sidecar response was not JSON');
  }
  return { bytes, truncated, data };
}
