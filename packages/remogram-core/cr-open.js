import { sanitizeField, sanitizeUrl, sanitizeWriteTitleWithMeta, sanitizeWriteBodyWithMeta, assertWriteFieldNotTruncated } from './caps.js';
import { ERROR_CODES, forgeError } from './contracts/errors.js';

export function parseCrOpenWriteArgs({ title, body: prBody }, writeFieldPolicy = null) {
  if (title == null || String(title).trim() === '') {
    throw Object.assign(new Error('--title required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--title required for cr open'),
    });
  }
  const titleMeta = sanitizeWriteTitleWithMeta(String(title), writeFieldPolicy);
  assertWriteFieldNotTruncated(titleMeta, 'title', writeFieldPolicy);
  const parsed = { title: titleMeta.value };
  if (prBody != null && String(prBody).trim() !== '') {
    const bodyMeta = sanitizeWriteBodyWithMeta(String(prBody), writeFieldPolicy);
    parsed.body = assertWriteFieldNotTruncated(bodyMeta, 'body', writeFieldPolicy);
  }
  return parsed;
}

/** Normalize Gitea pull create response into change_request_opened body fields. */
export function buildChangeRequestOpenedBody(
  pull,
  { head, base, title },
  { reusedExisting = false, idempotencyFields = null } = {},
) {
  const prNumber = Number(pull?.number);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw Object.assign(new Error('Provider returned invalid pull number'), {
      forgeError: forgeError(
        ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT,
        'Provider returned invalid pull number',
      ),
    });
  }
  const resolvedTitle = reusedExisting
    ? sanitizeField(pull?.title ?? title)
    : sanitizeField(title ?? pull?.title);
  const body = {
    pr_number: prNumber,
    url: sanitizeUrl(pull.html_url ?? pull.url),
    head: sanitizeField(head),
    base: sanitizeField(base),
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
