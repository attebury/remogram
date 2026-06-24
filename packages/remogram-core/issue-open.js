import { sanitizeReadField, sanitizeWriteTitleWithMeta, sanitizeWriteBodyWithMeta, assertWriteFieldNotTruncated, sanitizeUrl } from './caps.js';
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
    ? sanitizeReadField(issue?.title ?? title)
    : sanitizeReadField(title ?? issue?.title);
  const body = {
    issue_number: issueNumber,
    url: sanitizeUrl(issue.html_url ?? issue.url),
    state: sanitizeReadField(String(issue?.state ?? 'open').toLowerCase()),
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

export function parseIssueOpenArgs({ title, body: issueBody }, writeFieldPolicy = null) {
  if (title == null || String(title).trim() === '') {
    throw Object.assign(new Error('--title required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--title required for issue open'),
    });
  }
  const titleMeta = sanitizeWriteTitleWithMeta(String(title), writeFieldPolicy);
  assertWriteFieldNotTruncated(titleMeta, 'title', writeFieldPolicy);
  const parsed = { title: titleMeta.value };
  if (issueBody != null && String(issueBody).trim() !== '') {
    const bodyMeta = sanitizeWriteBodyWithMeta(String(issueBody), writeFieldPolicy);
    parsed.body = assertWriteFieldNotTruncated(bodyMeta, 'body', writeFieldPolicy);
  }
  return parsed;
}
