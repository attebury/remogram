export const ERROR_CODES = {
  STALE_HEAD: 'stale_head',
  MISSING_REF: 'missing_ref',
  DIVERGENT_REMOTES: 'divergent_remotes',
  UNPARSEABLE_PROVIDER_OUTPUT: 'unparseable_provider_output',
  OVERSIZED_RAW_OUTPUT: 'oversized_raw_output',
  UNAUTHENTICATED_PROVIDER: 'unauthenticated_provider',
  UNTRUSTED_BASE_URL: 'untrusted_base_url',
  CONFIG_INVALID: 'config_invalid',
  PROVIDER_UNSUPPORTED: 'provider_unsupported',
  CONFIG_NOT_FOUND: 'config_not_found',
  INVALID_ARGS: 'invalid_args',
  API_ERROR: 'api_error',
  PR_NOT_OPEN: 'pr_not_open',
  REMOTE_INFER_FAILED: 'remote_infer_failed',
};

export function forgeError(code, message, status = null) {
  return { code, message, ...(status != null ? { status } : {}) };
}
