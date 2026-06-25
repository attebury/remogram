import { ERROR_CODES, forgeError } from './contracts/errors.js';
import { sanitizeField, sanitizeUrl } from './caps.js';

const ISSUE_STATES = new Set(['open', 'closed']);

export function parseIssueBundleArgs({ issue_number, state, title, url, linked_pr }) {
  const n = Number(issue_number);
  if (!Number.isInteger(n) || n <= 0) {
    throw Object.assign(new Error('--issue-number required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--issue-number required for issue bundle'),
    });
  }
  const parsed = { issue_number: n };
  if (state != null && String(state).trim() !== '') {
    const normalized = sanitizeField(String(state).toLowerCase());
    if (!ISSUE_STATES.has(normalized)) {
      throw Object.assign(new Error('invalid state'), {
        forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--state must be one of: open, closed'),
      });
    }
    parsed.state = normalized;
  }
  if (title != null && String(title).trim() !== '') {
    parsed.title = sanitizeField(String(title));
  }
  if (url != null && String(url).trim() !== '') {
    parsed.url = sanitizeUrl(String(url));
  }
  if (linked_pr != null && String(linked_pr).trim() !== '') {
    const prNumber = Number(linked_pr);
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      throw Object.assign(new Error('invalid linked PR number'), {
        forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--linked-pr must be a positive integer'),
      });
    }
    parsed.linked_pr = prNumber;
  }
  return parsed;
}

export function buildIssueBundleBody(args) {
  return {
    ...args,
    bundle_ready: true,
  };
}
