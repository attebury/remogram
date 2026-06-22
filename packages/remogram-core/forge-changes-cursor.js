import { ERROR_CODES, forgeError } from './contracts/errors.js';
import { parseSinceObservedAt } from './forge-changes.js';

export const FORGE_CHANGES_CURSOR_VERSION = 1;
export const DEFAULT_FORGE_CHANGES_PAGE_SIZE = 64;

/**
 * @param {{ since: string, offset: number }} state
 * @returns {string}
 */
export function encodeForgeChangesCursor(state) {
  const since = parseSinceObservedAt(state.since);
  const offset = Number(state.offset);
  if (!Number.isInteger(offset) || offset < 0) {
    throw Object.assign(new Error('Invalid forge changes cursor offset'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, 'cursor offset must be a non-negative integer'),
    });
  }
  const payload = JSON.stringify({ v: FORGE_CHANGES_CURSOR_VERSION, since, offset });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * @param {unknown} raw
 * @param {{ since?: string }} [opts]
 * @returns {{ since: string, offset: number }}
 */
export function decodeForgeChangesCursor(raw, opts = {}) {
  if (raw == null || raw === '') {
    throw Object.assign(new Error('Missing forge changes cursor'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--cursor must not be empty when provided'),
    });
  }
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid forge changes cursor'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--cursor is malformed or not base64url JSON'),
    });
  }
  if (decoded?.v !== FORGE_CHANGES_CURSOR_VERSION) {
    throw Object.assign(new Error('Invalid forge changes cursor version'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--cursor version is unsupported'),
    });
  }
  const since = parseSinceObservedAt(decoded.since);
  const offset = Number(decoded.offset);
  if (!Number.isInteger(offset) || offset < 0) {
    throw Object.assign(new Error('Invalid forge changes cursor offset'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--cursor offset must be a non-negative integer'),
    });
  }
  if (opts.since != null && opts.since !== '') {
    const requestedSince = parseSinceObservedAt(opts.since);
    if (requestedSince !== since) {
      throw Object.assign(new Error('Forge changes cursor since mismatch'), {
        forgeError: forgeError(
          ERROR_CODES.INVALID_ARGS,
          '--since must match the cursor since when both are provided',
        ),
      });
    }
  }
  return { since, offset };
}

/**
 * @param {object} body
 * @param {{ offset?: number, limit?: number }} [opts]
 */
export function paginateForgeChangesBody(body, opts = {}) {
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? DEFAULT_FORGE_CHANGES_PAGE_SIZE;
  const allEvents = Array.isArray(body.events) ? body.events : [];
  const pageEvents = allEvents.slice(offset, offset + limit);
  const observedEnd = offset + pageEvents.length;
  const hasMore = observedEnd < allEvents.length || body.events_truncated === true;
  return {
    ...body,
    events: pageEvents,
    has_more: hasMore,
    complete: !hasMore,
    ...(hasMore
      ? { next_cursor: encodeForgeChangesCursor({ since: body.since, offset: observedEnd }) }
      : {}),
  };
}
