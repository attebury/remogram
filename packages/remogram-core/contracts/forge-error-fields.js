import { ERROR_CODES } from './errors.js';

/** Top-level packet keys forge error fields must never override. */
const FORBIDDEN_ERROR_FIELD_KEYS = new Set([
  'type',
  'schema_version',
  'provider_id',
  'remote_name',
  'repo_id',
  'base_url',
  'observed_at',
  'ok',
  'error_code',
  'error_message',
  'error_status',
]);

/** Trusted body fields allowed per forge error code. */
export const FORGE_ERROR_FIELD_ALLOWLIST = Object.freeze({
  [ERROR_CODES.IDEMPOTENCY_SCAN_INCOMPLETE]: ['idempotency_scan'],
  [ERROR_CODES.INVENTORY_LIST_INCOMPLETE]: ['inventory_list'],
});

function assertPositiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid forge error field ${name}: must be a positive integer`);
  }
}

function validateIdempotencyScan(scan) {
  if (scan == null || typeof scan !== 'object' || Array.isArray(scan)) {
    throw new Error('Invalid forge error field idempotency_scan: must be an object');
  }
  const keys = Object.keys(scan).sort();
  const expected = ['max_pages', 'page_size', 'pages'];
  if (keys.length !== expected.length || !expected.every((k) => keys.includes(k))) {
    throw new Error('Invalid forge error field idempotency_scan: unexpected keys');
  }
  assertPositiveInteger('idempotency_scan.pages', scan.pages);
  assertPositiveInteger('idempotency_scan.max_pages', scan.max_pages);
  assertPositiveInteger('idempotency_scan.page_size', scan.page_size);
  return { idempotency_scan: scan };
}

function validateInventoryList(list) {
  if (list == null || typeof list !== 'object' || Array.isArray(list)) {
    throw new Error('Invalid forge error field inventory_list: must be an object');
  }
  const keys = Object.keys(list).sort();
  if (keys.length !== 1 || keys[0] !== 'entry_count') {
    throw new Error('Invalid forge error field inventory_list: unexpected keys');
  }
  assertPositiveInteger('inventory_list.entry_count', list.entry_count);
  return { inventory_list: list };
}

/**
 * Validate and normalize trusted forge_error body fields before packet merge.
 * @param {string} code
 * @param {Record<string, unknown> | null | undefined} fields
 * @returns {Record<string, unknown> | null}
 */
export function normalizeForgeErrorFields(code, fields) {
  if (fields == null) return null;
  if (typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error('Invalid forge error fields: must be an object');
  }

  const keys = Object.keys(fields);
  if (keys.length === 0) return null;

  for (const key of keys) {
    if (FORBIDDEN_ERROR_FIELD_KEYS.has(key)) {
      throw new Error(`Forge error fields cannot override packet field ${key}`);
    }
  }

  const allowlist = FORGE_ERROR_FIELD_ALLOWLIST[code];
  if (!allowlist) {
    throw new Error(`Forge error code ${code} does not allow trusted fields`);
  }

  for (const key of keys) {
    if (!allowlist.includes(key)) {
      throw new Error(`Forge error field ${key} is not allowed for code ${code}`);
    }
  }

  if (fields.idempotency_scan != null) {
    return validateIdempotencyScan(fields.idempotency_scan);
  }

  if (fields.inventory_list != null) {
    return validateInventoryList(fields.inventory_list);
  }

  return fields;
}
