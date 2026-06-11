import { ERROR_CODES, forgeError } from './contracts/errors.js';

export function createStubProvider(id) {
  function unsupported() {
    const err = new Error('Provider not implemented');
    err.forgeError = forgeError(ERROR_CODES.PROVIDER_UNSUPPORTED, 'Provider not implemented in v1');
    throw err;
  }
  function providerCapabilities() {
    return {
      commands: [
        { name: 'repo_status', implemented: false },
        { name: 'ref_compare', implemented: false },
        { name: 'pr_status', implemented: false },
        { name: 'pr_checks', implemented: false },
        { name: 'merge_plan', implemented: false },
        { name: 'sync_plan', implemented: false },
      ],
      auth_envs: [],
      check_sources: [],
      mergeability_confidence: 'unknown',
      host_binding: 'unsupported',
      pagination: 'unsupported',
      write_support: false,
    };
  }
  return {
    id,
    providerCapabilities,
    repoStatus: unsupported,
    refsCompare: unsupported,
    prView: unsupported,
    prChecks: unsupported,
    mergePlan: unsupported,
    syncPlan: unsupported,
  };
}
