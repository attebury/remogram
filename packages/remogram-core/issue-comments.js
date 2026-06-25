import { sanitizeField } from './caps.js';

export const MAX_ISSUE_COMMENTS = 256;

export function normalizeIssueComment(raw) {
  if (raw == null || typeof raw !== 'object') return null;
  const id = raw.id ?? raw.comment_id;
  if (id == null) return null;

  const author =
    sanitizeField(
      raw.author ??
        raw.user?.login ??
        raw.user?.username ??
        raw.user?.name ??
        '',
    ) || null;
  const body = sanitizeField(raw.body ?? raw.note ?? '') ?? '';
  return {
    id: sanitizeField(String(id)),
    author,
    body,
  };
}

export function buildIssueCommentsBody({
  issue_number,
  comments,
  comments_truncated,
  comment_count,
}) {
  const list = Array.isArray(comments) ? comments : [];
  const count = Number.isFinite(Number(comment_count))
    ? Math.floor(Number(comment_count))
    : list.length;
  return {
    issue_number: Math.floor(Number(issue_number)),
    comments: list,
    comments_truncated: Boolean(comments_truncated),
    comment_count: count,
  };
}

function buildIssueCommentsFromNormalizedList(issueNumber, all) {
  const comment_count = all.length;
  const capped = all.length > MAX_ISSUE_COMMENTS;
  const comments = all.slice(0, MAX_ISSUE_COMMENTS);
  return buildIssueCommentsBody({
    issue_number: issueNumber,
    comments,
    comments_truncated: capped,
    comment_count,
  });
}

export function buildIssueCommentsFromGiteaComments(issueNumber, commentsArray) {
  const all = [];
  if (Array.isArray(commentsArray)) {
    for (const item of commentsArray) {
      const normalized = normalizeIssueComment(item);
      if (normalized) all.push(normalized);
    }
  }
  return buildIssueCommentsFromNormalizedList(issueNumber, all);
}
