import { ERROR_CODES, forgeError } from './contracts/errors.js';
import { sanitizeField } from './caps.js';

const REVIEW_DECISIONS = new Set(['approved', 'changes_requested', 'commented']);

export function parseReviewBundleArgs({
  number,
  reviewed_head_sha,
  reviewed_base_sha,
  decision,
  summary,
}) {
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) {
    throw Object.assign(new Error('--number required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--number required for review bundle'),
    });
  }
  const parsed = { pr_number: n };
  if (reviewed_head_sha != null && String(reviewed_head_sha).trim() !== '') {
    parsed.reviewed_head_sha = sanitizeField(String(reviewed_head_sha).toLowerCase());
  }
  if (reviewed_base_sha != null && String(reviewed_base_sha).trim() !== '') {
    parsed.reviewed_base_sha = sanitizeField(String(reviewed_base_sha).toLowerCase());
  }
  if (decision != null && String(decision).trim() !== '') {
    const normalized = sanitizeField(String(decision).toLowerCase());
    if (!REVIEW_DECISIONS.has(normalized)) {
      throw Object.assign(new Error('invalid decision'), {
        forgeError: forgeError(
          ERROR_CODES.INVALID_ARGS,
          '--decision must be one of: approved, changes_requested, commented',
        ),
      });
    }
    parsed.decision = normalized;
  }
  if (summary != null && String(summary).trim() !== '') {
    parsed.summary = sanitizeField(summary);
  }
  return parsed;
}

export function buildReviewBundleBody(args) {
  return {
    ...args,
    bundle_ready: true,
  };
}
