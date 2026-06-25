import { ERROR_CODES, forgeError } from './contracts/errors.js';

/**
 * Canonical forge origin (scheme + host + port) from configured baseUrl.
 * Config-derived trusted identity — not forge-sourced.
 *
 * @param {{ baseUrl?: string }} config
 * @returns {string | null}
 */
export function normalizedForgeOrigin(config) {
  if (!config?.baseUrl) return null;
  let url;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw Object.assign(new Error('Invalid baseUrl'), {
      forgeError: forgeError(ERROR_CODES.CONFIG_INVALID, 'Invalid baseUrl in .remogram.json'),
    });
  }
  if (url.username || url.password) {
    throw Object.assign(new Error('baseUrl must not contain userinfo'), {
      forgeError: forgeError(ERROR_CODES.CONFIG_INVALID, 'baseUrl must not contain userinfo'),
    });
  }
  if (url.pathname && url.pathname !== '/') {
    throw Object.assign(new Error('baseUrl must be a forge origin'), {
      forgeError: forgeError(
        ERROR_CODES.CONFIG_INVALID,
        'baseUrl must be a forge origin without a path',
      ),
    });
  }
  if (url.search || url.hash) {
    throw Object.assign(new Error('baseUrl must be a forge origin'), {
      forgeError: forgeError(
        ERROR_CODES.CONFIG_INVALID,
        'baseUrl must be a forge origin without query or fragment',
      ),
    });
  }
  return url.origin;
}
