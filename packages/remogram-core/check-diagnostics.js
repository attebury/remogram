import { sanitizeField } from './caps.js';

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {object} entry
 * @param {{ headSha?: string | null, requiredContexts?: Set<string> }} opts
 */
export function enrichCheckStatus(entry, opts = {}) {
  const headSha = opts.headSha ?? null;
  const context = sanitizeField(entry?.context);
  const rawSha = entry?.sha != null ? sanitizeField(entry.sha) : headSha;
  const sha = rawSha || null;
  const stale = Boolean(headSha && sha && sha !== headSha);
  const required = context ? opts.requiredContexts?.has(context) === true : false;
  return {
    context,
    state: entry?.state ?? 'unknown',
    ...(sha ? { sha } : {}),
    required,
    source: sanitizeField(entry?.source) || 'commit_status',
    ...(entry?.target_url ? { target_url: sanitizeField(entry.target_url) } : {}),
    ...(entry?.description ? { description: sanitizeField(entry.description) } : {}),
    ...(stale ? { stale: true } : {}),
  };
}

/**
 * @param {object[]} statuses
 * @param {{ headSha?: string | null, requiredContexts?: string[] }} opts
 */
export function buildCheckDiagnostics(statuses, opts = {}) {
  const headSha = opts.headSha ?? null;
  const requiredContexts = uniqueSorted(
    Array.isArray(opts.requiredContexts) ? opts.requiredContexts.map((c) => sanitizeField(c)) : [],
  );
  const requiredSet = new Set(requiredContexts);
  const enriched = (Array.isArray(statuses) ? statuses : []).map((entry) =>
    enrichCheckStatus(entry, { headSha, requiredContexts: requiredSet }),
  );
  const byContext = new Map();
  for (const status of enriched) {
    if (status.context) byContext.set(status.context, status);
  }

  const failed_contexts = [];
  const pending_contexts = [];
  const stale_contexts = [];
  for (const status of enriched) {
    if (!status.context) continue;
    if (status.stale === true) stale_contexts.push(status.context);
    if (status.state === 'failure') failed_contexts.push(status.context);
    if (status.state === 'pending') pending_contexts.push(status.context);
  }

  const missing_required_contexts = [];
  for (const context of requiredContexts) {
    if (!byContext.has(context)) missing_required_contexts.push(context);
  }

  return {
    statuses: enriched,
    required_contexts: requiredContexts,
    missing_required_contexts: uniqueSorted(missing_required_contexts),
    failed_contexts: uniqueSorted(failed_contexts),
    pending_contexts: uniqueSorted(pending_contexts),
    stale_contexts: uniqueSorted(stale_contexts),
  };
}

/**
 * @param {{ forge_source_sha: string, check_conclusion: string, checks_truncated?: boolean, statuses?: object[], required_contexts?: string[] }} body
 */
export function buildPrChecksBody(body) {
  const diagnostics = buildCheckDiagnostics(body.statuses ?? [], {
    headSha: body.forge_source_sha,
    requiredContexts: body.required_contexts ?? [],
  });
  return {
    forge_source_sha: body.forge_source_sha,
    check_conclusion: body.check_conclusion,
    checks_truncated: body.checks_truncated === true,
    statuses: diagnostics.statuses,
    required_contexts: diagnostics.required_contexts,
    missing_required_contexts: diagnostics.missing_required_contexts,
    failed_contexts: diagnostics.failed_contexts,
    pending_contexts: diagnostics.pending_contexts,
    stale_contexts: diagnostics.stale_contexts,
  };
}
