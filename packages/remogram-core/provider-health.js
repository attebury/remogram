import { ERROR_CODES } from './contracts/errors.js';
import { sanitizeField } from './caps.js';

const LIVE_REACHABILITY_TIMEOUT_MS = 5000;

export { LIVE_REACHABILITY_TIMEOUT_MS };

export function classifyReachabilityFailure(err) {
  const code = err?.forgeError?.code;
  const status = err?.status ?? err?.forgeError?.status ?? null;
  let causeCode = null;
  for (let current = err; current; current = current.cause) {
    if (current.code) {
      causeCode = current.code;
      break;
    }
  }
  const message = String(err?.forgeError?.message ?? err?.message ?? '');

  if (code === ERROR_CODES.UNAUTHENTICATED_PROVIDER) return 'auth_missing';
  if (code === ERROR_CODES.OVERSIZED_RAW_OUTPUT) return 'oversized_raw_output';
  if (status === 401 || /401/.test(message)) return 'http_401';
  if (status === 404 || /not found/i.test(message)) return 'repo_not_found';
  if (status >= 300 && status < 400) return 'redirect_rejected';
  if (/redirect rejected/i.test(message)) return 'redirect_rejected';
  if (causeCode === 'ECONNREFUSED') return 'connection_refused';
  if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN') return 'network_unreachable';
  if (causeCode === 'ECONNRESET' || causeCode === 'ENETUNREACH') return 'network_unreachable';
  if (err?.name === 'TimeoutError' || causeCode === 'ETIMEDOUT' || /timed out/i.test(message)) {
    return 'timeout';
  }
  return 'network_unreachable';
}

export function doctorReachabilityCheck(name, status, message, details = null) {
  return {
    name,
    status,
    message: sanitizeField(message),
    ...(details ? { details } : {}),
  };
}

/**
 * @param {object} ctx
 * @param {object | undefined} provider
 * @param {{ live?: boolean, prerequisitesPass?: boolean }} [opts]
 */
export async function buildApiReachabilityCheck(ctx, provider, opts = {}) {
  const { live = false, prerequisitesPass = false } = opts;
  if (!live) {
    return doctorReachabilityCheck(
      'api_reachability',
      'skipped',
      'Live API reachability is not checked by default',
    );
  }
  if (!prerequisitesPass) {
    return doctorReachabilityCheck(
      'api_reachability',
      'fail',
      'Live reachability requires valid config and trusted host binding',
      { failure_kind: 'prerequisites_failed' },
    );
  }
  if (typeof provider?.apiReachability !== 'function') {
    return doctorReachabilityCheck(
      'api_reachability',
      'warn',
      'Provider does not implement live API reachability',
      { failure_kind: 'not_implemented' },
    );
  }
  try {
    const facts = await provider.apiReachability(ctx);
    return doctorReachabilityCheck(
      'api_reachability',
      'pass',
      'Forge API is reachable',
      { repo_accessible: true, ...(facts && typeof facts === 'object' ? facts : {}) },
    );
  } catch (err) {
    return doctorReachabilityCheck(
      'api_reachability',
      'fail',
      err.forgeError?.message || err.message || 'Forge API reachability check failed',
      {
        failure_kind: classifyReachabilityFailure(err),
        ...(err.status != null ? { http_status: err.status } : {}),
      },
    );
  }
}
