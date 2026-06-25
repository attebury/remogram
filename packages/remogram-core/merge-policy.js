export const ALLOW_MISSING_CHECKS_ENV = 'REMOGRAM_ALLOW_MISSING_CHECKS';
export const ALLOW_PENDING_CHECKS_ENV = 'REMOGRAM_ALLOW_PENDING_CHECKS';

/** @returns {boolean | null} true/false when recognized; null when unset/invalid */
export function parseTruthyEnv(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function resolvePolicyFlag(configValue, envName) {
  const envRaw = process.env[envName];
  if (envRaw != null && envRaw !== '') {
    const parsed = parseTruthyEnv(envRaw);
    if (parsed === true) {
      return { value: true, source: 'env' };
    }
  }
  if (configValue === true) {
    return { value: true, source: 'config' };
  }
  return { value: false, source: 'default' };
}

/**
 * Resolved merge policy for blocker derivation (forge-facts layer only).
 * @param {object | null | undefined} config consumer .remogram.json
 */
export function resolveMergePolicy(config) {
  const filePolicy = config?.merge_policy ?? {};
  const missing = resolvePolicyFlag(filePolicy.allow_missing_checks, ALLOW_MISSING_CHECKS_ENV);
  const pending = resolvePolicyFlag(filePolicy.allow_pending_checks, ALLOW_PENDING_CHECKS_ENV);
  return {
    allow_missing_checks: missing.value,
    allow_pending_checks: pending.value,
    source: {
      allow_missing_checks: missing.source,
      allow_pending_checks: pending.source,
    },
  };
}

/** Observational snapshot for merge execute before facts. */
export function mergePolicyAuditFacts(mergePolicy) {
  if (!mergePolicy) return null;
  return {
    allow_missing_checks: mergePolicy.allow_missing_checks === true,
    allow_pending_checks: mergePolicy.allow_pending_checks === true,
    source: mergePolicy.source ?? {
      allow_missing_checks: 'default',
      allow_pending_checks: 'default',
    },
  };
}
