import { gitDiffNameOnly } from './git-local.js';
import { mergeBlockersFromFacts } from './merge-blockers.js';

function normalizeAllowedPaths(allowedPaths) {
  if (!Array.isArray(allowedPaths)) return null;
  const normalized = allowedPaths.filter((entry) => typeof entry === 'string' && entry.length > 0);
  return normalized.length > 0 ? normalized : null;
}

export function resolveMergePlanPathScope(ctx, view, opts = {}) {
  const allowedPaths = normalizeAllowedPaths(opts.allowed_paths);
  if (!allowedPaths) {
    return { allowed_paths: null, changed_paths: null };
  }
  if (!view.base_sha || !view.head_sha) {
    return { allowed_paths: allowedPaths, changed_paths: null };
  }
  const changedPaths = gitDiffNameOnly(ctx.cwd, view.base_sha, view.head_sha);
  return { allowed_paths: allowedPaths, changed_paths: changedPaths };
}

export function buildMergePlanBody(view, checks, pathScope = {}) {
  return {
    pr_number: view.pr_number,
    mergeability: view.mergeability,
    checks_conclusion: checks.check_conclusion,
    blockers: mergeBlockersFromFacts(view, checks, pathScope),
  };
}

export function buildMergePlanBodyFromFacts(ctx, view, checks, opts = {}) {
  const pathScope = resolveMergePlanPathScope(ctx, view, opts);
  return buildMergePlanBody(view, checks, pathScope);
}
