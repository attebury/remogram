import { createHash } from 'node:crypto';
import { sanitizeField } from './caps.js';
import { ERROR_CODES, forgeError } from './contracts/errors.js';

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** @type {Map<string, string>} */
const scopeBindings = new Map();

export function resetIdempotencyScopeBindings() {
  scopeBindings.clear();
}

export function normalizeIdempotencyKey(value) {
  if (value == null || value === '') return null;
  const key = sanitizeField(String(value).trim());
  if (!key || !KEY_PATTERN.test(key)) {
    throw Object.assign(new Error('Invalid idempotency key'), {
      forgeError: forgeError(
        ERROR_CODES.INVALID_ARGS,
        'idempotency key must be 1-128 characters from [A-Za-z0-9._:-]',
      ),
    });
  }
  return key;
}

export function idempotencyFingerprint(key, scopeParts = []) {
  const normalizedKey = normalizeIdempotencyKey(key);
  if (!normalizedKey) return null;
  const scope = scopeParts.map((part) => sanitizeField(String(part ?? ''))).join('\0');
  return createHash('sha256').update(`${normalizedKey}\0${scope}`).digest('hex').slice(0, 16);
}

export function idempotencyScopeKey(repoId, key) {
  const normalizedKey = normalizeIdempotencyKey(key);
  if (!normalizedKey) return null;
  return `${sanitizeField(repoId)}:${normalizedKey}`;
}

export function bindIdempotencyScope(repoId, key, scopeParts) {
  const normalizedKey = normalizeIdempotencyKey(key);
  if (!normalizedKey) return null;
  const bindingKey = idempotencyScopeKey(repoId, normalizedKey);
  const serialized = JSON.stringify(scopeParts.map((part) => sanitizeField(String(part ?? ''))));
  const prior = scopeBindings.get(bindingKey);
  if (prior && prior !== serialized) {
    throw Object.assign(new Error('Idempotency key scope conflict'), {
      forgeError: forgeError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        'idempotency key was already used with a different write scope',
      ),
    });
  }
  scopeBindings.set(bindingKey, serialized);
  return idempotencyFingerprint(normalizedKey, scopeParts);
}

export function idempotencyPacketFields(fingerprint, { reusedExisting = false, ambiguousAfterWrite = false } = {}) {
  const fields = {};
  if (fingerprint) fields.idempotency_fingerprint = fingerprint;
  if (reusedExisting) {
    fields.reused_existing = true;
  } else {
    fields.created = true;
  }
  if (ambiguousAfterWrite) fields.ambiguous_after_write = true;
  return fields;
}
