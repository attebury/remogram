function unsupported() {
  const err = new Error('Provider not implemented');
  err.forgeError = { code: 'provider_unsupported', message: 'Provider not implemented in v1' };
  throw err;
}

export function createStubProvider(id) {
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
