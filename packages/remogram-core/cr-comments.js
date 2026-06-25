import { sanitizeField } from './caps.js';

export const MAX_CR_COMMENTS = 256;

export function normalizeCrComment(raw) {
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
  const path =
    raw.path != null && String(raw.path).trim() !== '' ? sanitizeField(raw.path) : null;
  const lineRaw = raw.line ?? raw.original_line ?? raw.new_line;
  const line =
    lineRaw != null && Number.isFinite(Number(lineRaw)) ? Math.floor(Number(lineRaw)) : null;
  const body = sanitizeField(raw.body ?? raw.note ?? '') ?? '';
  const resolved = Boolean(raw.resolved ?? raw.is_resolved ?? false);

  return {
    id: sanitizeField(String(id)),
    author,
    path,
    line,
    body,
    resolved,
  };
}

export function buildCrCommentsBody({ pr_number, comments, comments_truncated, comment_count }) {
  const list = Array.isArray(comments) ? comments : [];
  const count = Number.isFinite(Number(comment_count))
    ? Math.floor(Number(comment_count))
    : list.length;
  return {
    pr_number: Math.floor(Number(pr_number)),
    comments: list,
    comments_truncated: Boolean(comments_truncated),
    comment_count: count,
  };
}

function buildCrCommentsFromNormalizedList(prNumber, all) {
  const comment_count = all.length;
  const capped = all.length > MAX_CR_COMMENTS;
  const comments = all.slice(0, MAX_CR_COMMENTS);
  return buildCrCommentsBody({
    pr_number: prNumber,
    comments,
    comments_truncated: capped,
    comment_count,
  });
}

export function buildCrCommentsFromGiteaComments(prNumber, commentsArray) {
  const all = [];
  if (Array.isArray(commentsArray)) {
    for (const item of commentsArray) {
      const normalized = normalizeCrComment(item);
      if (normalized) all.push(normalized);
    }
  }
  return buildCrCommentsFromNormalizedList(prNumber, all);
}

export function buildCrCommentsFromGitLabDiscussions(prNumber, discussionsArray) {
  const all = [];
  if (Array.isArray(discussionsArray)) {
    for (const discussion of discussionsArray) {
      const notes = Array.isArray(discussion?.notes) ? discussion.notes : [];
      for (const note of notes) {
        if (note?.system === true) continue;
        const position = note.position && typeof note.position === 'object' ? note.position : null;
        const normalized = normalizeCrComment({
          id: note.id,
          author: note.author?.username ?? note.author?.name ?? '',
          path: position?.new_path ?? position?.old_path ?? null,
          line: position?.new_line ?? position?.old_line ?? null,
          body: note.body ?? '',
          resolved: note.resolved ?? false,
        });
        if (normalized) all.push(normalized);
      }
    }
  }
  return buildCrCommentsFromNormalizedList(prNumber, all);
}
