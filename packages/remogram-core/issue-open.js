import { sanitizeField, sanitizeUrl } from './caps.js';
import { ERROR_CODES, forgeError } from './contracts/errors.js';

/** Normalize Gitea issue create response into issue_opened body fields. */
export function buildIssueOpenedBody(
  issue,
  { title },
  { reusedExisting = false, idempotencyFields = null } = {},
) {
  const issueNumber = Number(issue?.number);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw Object.assign(new Error('Provider returned invalid issue number'), {
      forgeError: forgeError(
        ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT,
        'Provider returned invalid issue number',
      ),
    });
  }
  const resolvedTitle = reusedExisting
    ? sanitizeField(issue?.title ?? title)
    : sanitizeField(title ?? issue?.title);
  const body = {
    issue_number: issueNumber,
    url: sanitizeUrl(issue.html_url ?? issue.url),
    state: sanitizeField(String(issue?.state ?? 'open').toLowerCase()),
    title: resolvedTitle,
  };
  if (reusedExisting) {
    body.reused_existing = true;
  } else {
    body.created = true;
  }
  if (idempotencyFields && typeof idempotencyFields === 'object') {
    Object.assign(body, idempotencyFields);
  }
  return body;
}

export function parseIssueOpenArgs({ title, body: issueBody }) {
  if (title == null || String(title).trim() === '') {
    throw Object.assign(new Error('--title required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--title required for issue open'),
    });
  }
  const parsed = { title: sanitizeField(String(title)) };
  if (issueBody != null && String(issueBody).trim() !== '') {
    parsed.body = sanitizeField(String(issueBody));
  }
  return parsed;
}
