import { sanitizeField } from './caps.js';

const MAX_DIAGNOSTIC_SUMMARY = 200;

/**
 * @param {unknown} err
 * @param {{ prNumber?: number | null }} [opts]
 * @returns {null | { failure_kind: string, retryable: boolean, recommended_recheck_command: string, diagnostic_summary: string }}
 */
export function classifyCheckReadFailure(err, opts = {}) {
  const status = err?.status ?? err?.forgeError?.status ?? null;
  const message = String(err?.forgeError?.message ?? err?.message ?? '');
  const lower = message.toLowerCase();
  const isTimeout = lower.includes('timeout') || lower.includes('etimedout');
  const is5xx = typeof status === 'number' && status >= 500 && status < 600;
  const isRefResolution = lower.includes('ref resolution') || lower.includes('killed');

  if (!isTimeout && !is5xx && !isRefResolution) {
    return null;
  }

  const numberPart = Number.isInteger(Number(opts.prNumber)) ? Number(opts.prNumber) : '<n>';
  let failure_kind = 'server_error';
  if (isTimeout) failure_kind = 'timeout';
  else if (isRefResolution) failure_kind = 'ref_resolution_failed';

  return {
    failure_kind,
    retryable: true,
    recommended_recheck_command: `remogram pr checks --number ${numberPart} --json`,
    diagnostic_summary: sanitizeField(message).slice(0, MAX_DIAGNOSTIC_SUMMARY),
  };
}

export function withCheckReadRecovery(forgeErr, recovery) {
  if (!recovery) return forgeErr;
  return {
    ...forgeErr,
    fields: {
      ...(forgeErr.fields ?? {}),
      recovery,
    },
  };
}
