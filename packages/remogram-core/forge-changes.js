import { sanitizeField, sanitizeUrl } from './caps.js';
import { ERROR_CODES, forgeError } from './contracts/errors.js';

export const MAX_FORGE_CHANGES_EVENTS = 256;

export const FORGE_CHANGE_EVENT_KINDS = Object.freeze({
  PR_OPENED: 'pr_opened',
  PR_CLOSED: 'pr_closed',
  PR_MERGED: 'pr_merged',
  HEAD_SHA_MOVED: 'head_sha_moved',
  CHECKS_CONCLUSION_OBSERVED: 'checks_conclusion_observed',
});

export function parseSinceObservedAt(raw) {
  if (raw == null || String(raw).trim() === '') {
    throw Object.assign(new Error('--since required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--since required for forge changes'),
    });
  }
  const ms = Date.parse(String(raw));
  if (!Number.isFinite(ms)) {
    throw Object.assign(new Error('Invalid --since'), {
      forgeError: forgeError(
        ERROR_CODES.INVALID_ARGS,
        '--since must be a parseable ISO-8601 timestamp',
      ),
    });
  }
  return new Date(ms).toISOString();
}

function timestampMs(value) {
  const ms = Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : null;
}

function isAtOrAfter(value, sinceIso) {
  const ms = timestampMs(value);
  const sinceMs = timestampMs(sinceIso);
  if (ms == null || sinceMs == null) return false;
  return ms >= sinceMs;
}

function isBefore(value, sinceIso) {
  const ms = timestampMs(value);
  const sinceMs = timestampMs(sinceIso);
  if (ms == null || sinceMs == null) return false;
  return ms < sinceMs;
}

function normalizePrState(state) {
  const normalized = String(state ?? '').toLowerCase();
  if (normalized === 'open') return 'open';
  if (normalized === 'closed') return 'closed';
  return 'unknown';
}

function normalizeIsoTimestamp(value) {
  const ms = timestampMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}

function baseEventFields(pull) {
  return {
    pr_number: Math.floor(Number(pull.number)),
    title: sanitizeField(pull.title ?? '') || null,
    url: sanitizeUrl(pull.html_url ?? pull.url) || null,
  };
}

export function buildChecksConclusionObservedEvent(prNumber, checksBody) {
  return {
    kind: FORGE_CHANGE_EVENT_KINDS.CHECKS_CONCLUSION_OBSERVED,
    pr_number: Math.floor(Number(prNumber)),
    forge_source_sha: sanitizeField(checksBody?.forge_source_sha ?? '') || null,
    check_conclusion: sanitizeField(checksBody?.check_conclusion ?? '') || 'unknown',
    checks_truncated: Boolean(checksBody?.checks_truncated ?? false),
  };
}

export function buildForgeChangesBody({
  since,
  events,
  events_truncated,
  event_count,
  since_kind = 'observed_at',
}) {
  const list = Array.isArray(events) ? events : [];
  const count = Number.isFinite(Number(event_count))
    ? Math.floor(Number(event_count))
    : list.length;
  return {
    since,
    since_kind,
    events: list,
    events_truncated: Boolean(events_truncated),
    event_count: count,
  };
}

function capForgeChangeEvents(allEvents, sinceIso, { listTruncated = false } = {}) {
  const event_count = allEvents.length;
  const capped = allEvents.length > MAX_FORGE_CHANGES_EVENTS;
  return buildForgeChangesBody({
    since: sinceIso,
    events: allEvents.slice(0, MAX_FORGE_CHANGES_EVENTS),
    events_truncated: capped || listTruncated,
    event_count,
  });
}

export function appendForgeChangeEvents(body, additionalEvents, { listTruncated = false } = {}) {
  const merged = [...(body.events ?? []), ...(Array.isArray(additionalEvents) ? additionalEvents : [])];
  return capForgeChangeEvents(merged, body.since, {
    listTruncated: listTruncated || body.events_truncated,
  });
}

export function buildForgeChangesFromGiteaPulls(sinceIso, pullsArray, opts = {}) {
  const since = parseSinceObservedAt(sinceIso);
  const events = [];
  if (Array.isArray(pullsArray)) {
    for (const pull of pullsArray) {
      if (pull == null || pull.number == null) continue;
      const state = normalizePrState(pull.state);
      const base = baseEventFields(pull);
      const createdAt = pull.created_at;
      const updatedAt = pull.updated_at;
      const closedAt = pull.closed_at;
      const mergedAt = pull.merged_at;
      const mergedInWindow = isAtOrAfter(mergedAt, since);

      if (isAtOrAfter(createdAt, since)) {
        events.push({
          kind: FORGE_CHANGE_EVENT_KINDS.PR_OPENED,
          ...base,
          state,
          opened_at: normalizeIsoTimestamp(createdAt),
        });
      }

      if (mergedInWindow) {
        events.push({
          kind: FORGE_CHANGE_EVENT_KINDS.PR_MERGED,
          ...base,
          state: 'closed',
          merged_at: normalizeIsoTimestamp(mergedAt),
        });
      }

      const closedNotMerged =
        state === 'closed' && (mergedAt == null || String(mergedAt).trim() === '');
      const closedInWindow =
        isAtOrAfter(closedAt, since) ||
        (closedAt == null && closedNotMerged && isAtOrAfter(updatedAt, since));
      if (!mergedInWindow && closedNotMerged && closedInWindow) {
        events.push({
          kind: FORGE_CHANGE_EVENT_KINDS.PR_CLOSED,
          ...base,
          state: 'closed',
          closed_at: normalizeIsoTimestamp(closedAt ?? updatedAt),
        });
      }

      if (
        state === 'open' &&
        isAtOrAfter(updatedAt, since) &&
        isBefore(createdAt, since)
      ) {
        events.push({
          kind: FORGE_CHANGE_EVENT_KINDS.HEAD_SHA_MOVED,
          ...base,
          state: 'open',
          forge_source_sha: sanitizeField(pull.head?.sha ?? '') || null,
          updated_at: normalizeIsoTimestamp(updatedAt),
        });
      }
    }
  }
  return capForgeChangeEvents(events, since, { listTruncated: Boolean(opts.listTruncated) });
}
