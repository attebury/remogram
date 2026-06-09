import { ERROR_CODES, forgeError } from './contracts/errors.js';

export function createStubProvider(id) {
  function unsupported() {
    const err = new Error('Provider not implemented');
    err.forgeError = forgeError(ERROR_CODES.PROVIDER_UNSUPPORTED, 'Provider not implemented in v1');
    throw err;
  }
  return {
    id,
    repoStatus: unsupported,
    refsCompare: unsupported,
    prView: unsupported,
    prChecks: unsupported,
    mergePlan: unsupported,
    syncPlan: unsupported,
  };
}
