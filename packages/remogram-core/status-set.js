import { sanitizeField, sanitizeUrl } from './caps.js';
import { ERROR_CODES, forgeError } from './contracts/errors.js';

/** Supported commit status states (Gitea/GitHub parity). */
export const STATUS_SET_STATES = Object.freeze(['pending', 'success', 'failure', 'error']);

const STATUS_SET_STATE_SET = new Set(STATUS_SET_STATES);

const FULL_SHA_RE = /^[0-9a-fA-F]{40}$/;

export function assertCommitSha(sha, label = 'sha') {
  const value = String(sha ?? '').trim();
  if (!FULL_SHA_RE.test(value)) {
    throw Object.assign(new Error(`Invalid ${label}`), {
      forgeError: forgeError(
        ERROR_CODES.INVALID_ARGS,
        `${label} must be a 40-character hexadecimal commit SHA`,
      ),
    });
  }
  return value.toLowerCase();
}

export function normalizeStatusSetState(state) {
  const normalized = String(state ?? '').toLowerCase();
  if (STATUS_SET_STATE_SET.has(normalized)) return normalized;
  if (normalized === 'pass') return 'success';
  if (normalized === 'fail') return 'failure';
  throw Object.assign(new Error('Invalid status state'), {
    forgeError: forgeError(
      ERROR_CODES.INVALID_ARGS,
      `state must be one of: ${STATUS_SET_STATES.join(', ')}`,
    ),
  });
}

export function parseStatusSetArgs({ sha, context, state, target_url, description }) {
  const parsedSha = assertCommitSha(sha, '--sha');
  if (context == null || String(context).trim() === '') {
    throw Object.assign(new Error('--context required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--context required for status set'),
    });
  }
  if (state == null || String(state).trim() === '') {
    throw Object.assign(new Error('--state required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--state required for status set'),
    });
  }
  const parsed = {
    sha: parsedSha,
    context: sanitizeField(String(context)),
    state: normalizeStatusSetState(state),
  };
  if (target_url != null && String(target_url).trim() !== '') {
    parsed.target_url = sanitizeUrl(String(target_url));
  }
  if (description != null && String(description).trim() !== '') {
    parsed.description = sanitizeField(String(description));
  }
  return parsed;
}

/** Normalize forge commit status POST/GET response into commit_status_set body fields. */
export function buildCommitStatusSetBody(
  response,
  args,
  { reusedExisting = false } = {},
) {
  const state = normalizeStatusSetState(response?.status ?? response?.state ?? args.state);
  const body = {
    sha: args.sha,
    context: sanitizeField(args.context),
    state,
  };
  const description = response?.description ?? args.description;
  if (description != null && String(description).trim() !== '') {
    body.description = sanitizeField(String(description));
  }
  const targetUrl = response?.target_url ?? args.target_url;
  if (targetUrl != null && String(targetUrl).trim() !== '') {
    body.target_url = sanitizeUrl(String(targetUrl));
  }
  if (reusedExisting) {
    body.reused_existing = true;
  }
  return body;
}
