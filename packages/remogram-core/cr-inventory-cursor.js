import { ERROR_CODES, forgeError } from './contracts/errors.js';
import { normalizeCrInventorySort } from './open-pull-list.js';

export const CR_INVENTORY_CURSOR_VERSION = 1;

/**
 * @param {{ sort: string, offset: number }} state
 * @returns {string}
 */
export function encodeCrInventoryCursor(state) {
  const sort = normalizeCrInventorySort(state.sort);
  const offset = Number(state.offset);
  if (!Number.isInteger(offset) || offset < 0) {
    throw Object.assign(new Error('Invalid cursor offset'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, 'cursor offset must be a non-negative integer'),
    });
  }
  const payload = JSON.stringify({ v: CR_INVENTORY_CURSOR_VERSION, sort, offset });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * @param {unknown} raw
 * @param {{ sort?: string | null }} [opts]
 * @returns {{ sort: string, offset: number }}
 */
export function decodeCrInventoryCursor(raw, opts = {}) {
  if (raw == null || raw === '') {
    throw Object.assign(new Error('Missing cursor'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--cursor must not be empty when provided'),
    });
  }
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid cursor'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--cursor is malformed or not base64url JSON'),
    });
  }
  if (decoded?.v !== CR_INVENTORY_CURSOR_VERSION) {
    throw Object.assign(new Error('Invalid cursor version'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--cursor version is unsupported'),
    });
  }
  const sort = normalizeCrInventorySort(decoded.sort);
  const offset = Number(decoded.offset);
  if (!Number.isInteger(offset) || offset < 0) {
    throw Object.assign(new Error('Invalid cursor offset'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--cursor offset must be a non-negative integer'),
    });
  }
  const requestedSort =
    opts.sort == null || opts.sort === '' ? null : normalizeCrInventorySort(opts.sort);
  if (requestedSort != null && requestedSort !== sort) {
    throw Object.assign(new Error('Cursor sort mismatch'), {
      forgeError: forgeError(
        ERROR_CODES.INVALID_ARGS,
        '--sort must match the cursor slice_sort when both are provided',
      ),
    });
  }
  return { sort, offset };
}
