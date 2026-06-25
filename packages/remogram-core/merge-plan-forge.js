import { ERROR_CODES } from './contracts/errors.js';
import {
  applyForgePathScopeForMergePlan,
  buildMergePlanBodyFromFacts,
  normalizeAllowedPaths,
} from './merge-plan.js';

/** Errors that must propagate from crFiles during merge-plan path scope — not mapped to changed_paths_unavailable. */
export const MERGE_PLAN_FORGE_SCOPE_RETHROW_CODES = new Set([
  ERROR_CODES.UNAUTHENTICATED_PROVIDER,
  ERROR_CODES.INVALID_ARGS,
  ERROR_CODES.UNTRUSTED_BASE_URL,
  ERROR_CODES.PROVIDER_UNSUPPORTED,
  ERROR_CODES.CONFIG_INVALID,
  ERROR_CODES.OVERSIZED_RAW_OUTPUT,
  ERROR_CODES.CONFIG_NOT_FOUND,
  ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT,
  ERROR_CODES.STALE_HEAD,
  ERROR_CODES.MISSING_REF,
  ERROR_CODES.PR_NOT_OPEN,
  ERROR_CODES.REMOTE_INFER_FAILED,
]);

export function isMergePlanForgeScopeRethrowError(err) {
  const code = err?.forgeError?.code;
  return typeof code === 'string' && MERGE_PLAN_FORGE_SCOPE_RETHROW_CODES.has(code);
}

export { normalizeAllowedPaths } from './merge-plan.js';

/**
 * Resolve merge plan opts with forge cr_files when an allowlist is configured.
 * @param {object} opts
 * @param {() => Promise<object>} crFilesFn
 */
export async function resolveMergePlanOptsWithForgePaths(opts, crFilesFn) {
  if (!normalizeAllowedPaths(opts.allowed_paths)) return opts;
  try {
    const crFilesBody = await crFilesFn();
    return applyForgePathScopeForMergePlan(opts, crFilesBody);
  } catch (err) {
    if (isMergePlanForgeScopeRethrowError(err)) throw err;
    // Intentional mask bucket: transient api_error → changed_paths_unavailable.
    // write_not_configured / idempotency codes are not emitted by crFiles today.
    return applyForgePathScopeForMergePlan(opts, null);
  }
}

/**
 * Build merge_plan body from provider deps (shared tri-provider orchestration).
 * @param {object} ctx
 * @param {object} opts
 * @param {{ prView: Function, prChecks: Function, crFiles: Function }} deps
 */
export async function buildMergePlanFromProviderFacts(ctx, opts, deps) {
  const view = await deps.prView(ctx, opts);
  const checks = await deps.prChecks(ctx, { number: view.pr_number });
  const mergeOpts = await resolveMergePlanOptsWithForgePaths(opts, () =>
    deps.crFiles(ctx, { number: view.pr_number }),
  );
  const mergePolicy = opts.merge_policy ?? ctx.mergePolicy ?? {};
  return buildMergePlanBodyFromFacts(view, checks, { ...mergeOpts, merge_policy: mergePolicy });
}
