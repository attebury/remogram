import { mergeBlockersFromFacts } from './merge-blockers.js';
import { normalizeChangedPathList } from './path-allowlist.js';

function allowlistGlobHasDotDotSegment(glob) {
  if (typeof glob !== 'string') return false;
  const normalized = glob.replace(/\\/g, '/');
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    return true;
  }
  return normalized.split('/').some((segment) => segment === '..');
}

export function normalizeAllowedPaths(allowedPaths) {
  if (!Array.isArray(allowedPaths)) return null;
  const normalized = allowedPaths
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !allowlistGlobHasDotDotSegment(entry));
  return normalized.length > 0 ? normalized : null;
}

/** True when cr_files body is complete enough for merge-plan path scope. */
export function isCrFilesScopeComplete(crFilesBody) {
  if (!crFilesBody || crFilesBody.paths_truncated) return false;
  const changedPaths = crFilesBody.changed_paths;
  if (!Array.isArray(changedPaths)) return false;
  const pathCount = Number.isFinite(Number(crFilesBody.path_count))
    ? Math.floor(Number(crFilesBody.path_count))
    : changedPaths.length;
  if (pathCount > 0 && changedPaths.length === 0) return false;
  if (pathCount > changedPaths.length) return false;
  if (changedPaths.length > pathCount) return false;
  return true;
}

/** Apply forge cr_files facts to merge plan opts when an allowlist is configured. */
export function applyForgePathScopeForMergePlan(opts, crFilesBody) {
  if (!normalizeAllowedPaths(opts.allowed_paths)) return opts;
  if (!isCrFilesScopeComplete(crFilesBody)) {
    return { ...opts, changed_paths: null };
  }
  const normalizedPaths = normalizeChangedPathList(crFilesBody.changed_paths);
  if (normalizedPaths == null) {
    return { ...opts, changed_paths: null };
  }
  return { ...opts, changed_paths: normalizedPaths };
}

export function resolveMergePlanPathScope(opts = {}) {
  const allowedPaths = normalizeAllowedPaths(opts.allowed_paths);
  if (!allowedPaths) {
    return { allowed_paths: null, changed_paths: null };
  }
  if (Array.isArray(opts.changed_paths)) {
    const normalizedPaths = normalizeChangedPathList(opts.changed_paths);
    return {
      allowed_paths: allowedPaths,
      changed_paths: normalizedPaths,
    };
  }
  return { allowed_paths: allowedPaths, changed_paths: null };
}

export function buildMergePlanBody(view, checks, pathScope = {}, policy = {}) {
  return {
    pr_number: view.pr_number,
    mergeability: view.mergeability,
    checks_conclusion: checks.check_conclusion,
    required_contexts: checks.required_contexts ?? [],
    missing_required_contexts: checks.missing_required_contexts ?? [],
    failed_contexts: checks.failed_contexts ?? [],
    pending_contexts: checks.pending_contexts ?? [],
    stale_contexts: checks.stale_contexts ?? [],
    blockers: mergeBlockersFromFacts(view, checks, pathScope, policy),
  };
}

export function buildMergePlanBodyFromFacts(view, checks, opts = {}) {
  const pathScope = resolveMergePlanPathScope(opts);
  const policy = opts.merge_policy ?? {};
  return buildMergePlanBody(view, checks, pathScope, policy);
}
