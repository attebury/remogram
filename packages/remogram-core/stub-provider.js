import { ERROR_CODES, forgeError } from './contracts/errors.js';
import { stubProviderCommands } from './auth-classes.js';

export function createStubProvider(id) {
  function unsupported() {
    const err = new Error('Provider not implemented');
    err.forgeError = forgeError(ERROR_CODES.PROVIDER_UNSUPPORTED, 'Provider not implemented in v1');
    throw err;
  }
  function providerCapabilities() {
    return {
      commands: stubProviderCommands(),
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
    refsInventory: unsupported,
    crInventory: unsupported,
    prView: unsupported,
    prChecks: unsupported,
    mergePlan: unsupported,
    syncPlan: unsupported,
  };
}
