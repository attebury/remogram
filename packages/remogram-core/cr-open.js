import { sanitizeField, sanitizeUrl } from './caps.js';

/** Normalize Gitea pull create response into change_request_opened body fields. */
export function buildChangeRequestOpenedBody(pull, { head, base, title }) {
  const prNumber = Number(pull?.number);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw Object.assign(new Error('Provider returned invalid pull number'), {
      message: 'Provider returned invalid pull number',
    });
  }
  return {
    pr_number: prNumber,
    url: sanitizeUrl(pull.html_url ?? pull.url),
    head: sanitizeField(head),
    base: sanitizeField(base),
    title: sanitizeField(title ?? pull.title),
  };
}
