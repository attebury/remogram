import { describe, it, expect } from 'vitest';
import {
  classifyReachabilityFailure,
  buildApiReachabilityCheck,
  ERROR_CODES,
  forgeError,
} from '@remogram/core';

describe('provider health', () => {
  it('classifyReachabilityFailure maps auth and redirect errors', () => {
    expect(
      classifyReachabilityFailure({
        forgeError: forgeError(ERROR_CODES.UNAUTHENTICATED_PROVIDER, 'token missing'),
      }),
    ).toBe('auth_missing');
    expect(
      classifyReachabilityFailure({
        status: 302,
        forgeError: forgeError(ERROR_CODES.API_ERROR, 'HTTP redirect rejected', 302),
      }),
    ).toBe('redirect_rejected');
    expect(classifyReachabilityFailure({ status: 401 })).toBe('http_401');
    expect(classifyReachabilityFailure({ status: 404 })).toBe('repo_not_found');
  });

  it('classifyReachabilityFailure maps network errors', () => {
    expect(classifyReachabilityFailure({ cause: { code: 'ECONNREFUSED' } })).toBe(
      'connection_refused',
    );
    expect(classifyReachabilityFailure({ name: 'TimeoutError' })).toBe('timeout');
    expect(classifyReachabilityFailure({ cause: { code: 'ENOTFOUND' } })).toBe(
      'network_unreachable',
    );
  });

  it('buildApiReachabilityCheck skips by default', async () => {
    const check = await buildApiReachabilityCheck({}, {}, { live: false });
    expect(check).toMatchObject({ name: 'api_reachability', status: 'skipped' });
  });

  it('buildApiReachabilityCheck fails prerequisites before network', async () => {
    const check = await buildApiReachabilityCheck({}, { apiReachability: async () => ({}) }, {
      live: true,
      prerequisitesPass: false,
    });
    expect(check).toMatchObject({
      status: 'fail',
      details: { failure_kind: 'prerequisites_failed' },
    });
  });

  it('buildApiReachabilityCheck passes on successful probe', async () => {
    const check = await buildApiReachabilityCheck(
      {},
      { apiReachability: async () => ({ repo_accessible: true }) },
      { live: true, prerequisitesPass: true },
    );
    expect(check).toMatchObject({
      status: 'pass',
      details: { repo_accessible: true },
    });
  });
});
