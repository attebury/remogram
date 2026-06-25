import { sanitizeField, sanitizeUrl } from './caps.js';
import { ERROR_CODES, forgeError } from './contracts/errors.js';

function normalizeIssueState(state) {
  const normalized = String(state ?? '').toLowerCase();
  if (normalized === 'open') return 'open';
  if (normalized === 'closed') return 'closed';
  return normalized || 'unknown';
}

export function buildLinkedChangeRequestBody(linkedChangeRequest) {
  if (!linkedChangeRequest || typeof linkedChangeRequest !== 'object') return null;
  const prNumber = Number(linkedChangeRequest.pr_number ?? linkedChangeRequest.number);
  if (!Number.isInteger(prNumber) || prNumber <= 0) return null;
  const body = {
    pr_number: prNumber,
  };
  const url = sanitizeUrl(linkedChangeRequest.url ?? linkedChangeRequest.html_url);
  if (url) body.url = url;
  const state = sanitizeField(linkedChangeRequest.state);
  if (state) body.state = state;
  const title = sanitizeField(linkedChangeRequest.title);
  if (title) body.title = title;
  return body;
}

/** Normalize provider issue payload into issue_status body fields. */
export function buildIssueViewBody(issue, { linkedChangeRequest = null } = {}) {
  const issueNumber = Number(issue?.number ?? issue?.issue_number);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw Object.assign(new Error('Provider returned invalid issue number'), {
      forgeError: forgeError(
        ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT,
        'Provider returned invalid issue number',
      ),
    });
  }
  const body = {
    issue_number: issueNumber,
    url: sanitizeUrl(issue?.html_url ?? issue?.url),
    state: normalizeIssueState(issue?.state),
    title: sanitizeField(issue?.title),
  };
  const linked = buildLinkedChangeRequestBody(linkedChangeRequest);
  if (linked) body.linked_change_request = linked;
  return body;
}
