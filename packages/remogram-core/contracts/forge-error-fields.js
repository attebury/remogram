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
  [ERROR_CODES.INVALID_ARGS]: ['remediation'],
  [ERROR_CODES.MERGE_ENDPOINT_FAILED]: ['recovery'],
  [ERROR_CODES.API_ERROR]: ['recovery'],
  [ERROR_CODES.IDEMPOTENCY_SCAN_INCOMPLETE]: ['idempotency_scan'],
  [ERROR_CODES.INVENTORY_LIST_INCOMPLETE]: ['inventory_list'],
  [ERROR_CODES.CONFIG_INVALID]: [
    'reason',
    'field',
    'expected',
    'actual',
    'discovered_via',
    'operator_config_path',
    'remediation',
  ],
  [ERROR_CODES.WRITE_FIELD_TRUNCATED]: ['field', 'original_bytes', 'cap_bytes'],
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

function validateConfigInvalidFields(fields) {
  const allowed = FORGE_ERROR_FIELD_ALLOWLIST[ERROR_CODES.CONFIG_INVALID];
  const out = {};
  for (const key of allowed) {
    if (fields[key] == null) continue;
    if (typeof fields[key] !== 'string') {
      throw new Error(`Invalid forge error field ${key}: must be a string`);
    }
    out[key] = fields[key];
  }
  return Object.keys(out).length ? out : null;
}

function validateInvalidArgsRemediation(remediation) {
  if (remediation == null || typeof remediation !== 'object' || Array.isArray(remediation)) {
    throw new Error('Invalid forge error field remediation: must be an object');
  }
  const keys = Object.keys(remediation).sort();
  const expected = ['hint', 'suggested_commands'];
  if (keys.length !== expected.length || !expected.every((k) => keys.includes(k))) {
    throw new Error('Invalid forge error field remediation: unexpected keys');
  }
  if (typeof remediation.hint !== 'string' || remediation.hint.trim() === '') {
    throw new Error('Invalid forge error field remediation.hint: must be a non-empty string');
  }
  if (!Array.isArray(remediation.suggested_commands) || remediation.suggested_commands.length === 0) {
    throw new Error('Invalid forge error field remediation.suggested_commands: must be a non-empty array');
  }
  for (const command of remediation.suggested_commands) {
    if (typeof command !== 'string' || command.trim() === '') {
      throw new Error('Invalid forge error field remediation.suggested_commands: all entries must be non-empty strings');
    }
  }
  return {
    remediation: {
      hint: remediation.hint,
      suggested_commands: [...remediation.suggested_commands],
    },
  };
}

function validateCheckReadRecovery(recovery) {
  if (recovery == null || typeof recovery !== 'object' || Array.isArray(recovery)) {
    throw new Error('Invalid forge error field recovery: must be an object');
  }
  const keys = Object.keys(recovery).sort();
  const expected = ['diagnostic_summary', 'failure_kind', 'recommended_recheck_command', 'retryable'];
  if (keys.length !== expected.length || !expected.every((k) => keys.includes(k))) {
    throw new Error('Invalid forge error field recovery: unexpected keys');
  }
  for (const key of ['failure_kind', 'recommended_recheck_command', 'diagnostic_summary']) {
    if (typeof recovery[key] !== 'string' || recovery[key].trim() === '') {
      throw new Error(`Invalid forge error field recovery.${key}: must be a non-empty string`);
    }
  }
  if (typeof recovery.retryable !== 'boolean') {
    throw new Error('Invalid forge error field recovery.retryable: must be a boolean');
  }
  return {
    recovery: {
      failure_kind: recovery.failure_kind,
      retryable: recovery.retryable,
      recommended_recheck_command: recovery.recommended_recheck_command,
      diagnostic_summary: recovery.diagnostic_summary,
    },
  };
}

function validateRecoveryFields(recovery) {
  if (recovery == null || typeof recovery !== 'object' || Array.isArray(recovery)) {
    throw new Error('Invalid forge error field recovery: must be an object');
  }
  const keys = Object.keys(recovery).sort();
  if (keys.includes('failure_kind')) {
    return validateCheckReadRecovery(recovery);
  }
  if (keys.length !== 1 || keys[0] !== 'suggested_commands') {
    throw new Error('Invalid forge error field recovery: unexpected keys');
  }
  if (!Array.isArray(recovery.suggested_commands) || recovery.suggested_commands.length === 0) {
    throw new Error('Invalid forge error field recovery.suggested_commands: must be a non-empty array');
  }
  if (recovery.suggested_commands.length > 3) {
    throw new Error('Invalid forge error field recovery.suggested_commands: maximum of 3 commands');
  }
  for (const command of recovery.suggested_commands) {
    if (typeof command !== 'string' || command.trim() === '') {
      throw new Error('Invalid forge error field recovery.suggested_commands: all entries must be non-empty strings');
    }
  }
  return { recovery: { suggested_commands: [...recovery.suggested_commands] } };
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

  if (code === ERROR_CODES.INVALID_ARGS && fields.remediation != null) {
    return validateInvalidArgsRemediation(fields.remediation);
  }
  if (code === ERROR_CODES.MERGE_ENDPOINT_FAILED && fields.recovery != null) {
    return validateRecoveryFields(fields.recovery);
  }
  if (code === ERROR_CODES.API_ERROR && fields.recovery != null) {
    return validateRecoveryFields(fields.recovery);
  }

  if (code === ERROR_CODES.CONFIG_INVALID) {
    return validateConfigInvalidFields(fields);
  }

  if (code === ERROR_CODES.WRITE_FIELD_TRUNCATED) {
    const out = {};
    if (typeof fields.field !== 'string' || fields.field.length === 0) {
      throw new Error('Invalid forge error field field: must be a non-empty string');
    }
    out.field = fields.field;
    assertPositiveInteger('original_bytes', fields.original_bytes);
    out.original_bytes = fields.original_bytes;
    if (fields.cap_bytes == null) {
      out.cap_bytes = null;
    } else {
      assertPositiveInteger('cap_bytes', fields.cap_bytes);
      out.cap_bytes = fields.cap_bytes;
    }
    return out;
  }

  return fields;
}
