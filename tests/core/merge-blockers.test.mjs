import { describe, it, expect } from 'vitest';
import { mergeBlockersFromFacts } from '@remogram/core';

describe('mergeBlockersFromFacts', () => {
  const openClean = { mergeability: 'clean', state: 'open' };
  const checksSuccess = { check_conclusion: 'success', checks_truncated: false };

  it('returns no blockers on the happy path', () => {
    expect(mergeBlockersFromFacts(openClean, checksSuccess)).toEqual([]);
  });

  it('blocks when check enumeration was truncated', () => {
    expect(
      mergeBlockersFromFacts(openClean, { check_conclusion: 'success', checks_truncated: true }),
    ).toEqual(['checks_incomplete']);
  });

  it('does not block when checks_truncated is omitted', () => {
    expect(mergeBlockersFromFacts(openClean, { check_conclusion: 'success' })).toEqual([]);
  });

  it('maps mergeability and check conclusions to shared vocabulary', () => {
    expect(
      mergeBlockersFromFacts({ mergeability: 'conflicted', state: 'open' }, checksSuccess),
    ).toEqual(['merge_conflict']);
    expect(mergeBlockersFromFacts(openClean, { check_conclusion: 'failure' })).toEqual([
      'checks_failed',
    ]);
    expect(mergeBlockersFromFacts(openClean, { check_conclusion: 'missing' })).toEqual([
      'checks_missing',
    ]);
    expect(mergeBlockersFromFacts(openClean, { check_conclusion: 'pending' })).toEqual([
      'checks_pending',
    ]);
    expect(mergeBlockersFromFacts({ mergeability: 'clean', state: 'closed' }, checksSuccess)).toEqual(
      ['pr_not_open'],
    );
    expect(mergeBlockersFromFacts({ mergeability: 'clean', state: 'Open' }, checksSuccess)).toEqual([]);
    expect(mergeBlockersFromFacts({ mergeability: 'clean', state: 'Closed' }, checksSuccess)).toEqual([
      'pr_not_open',
    ]);
  });

  it('blocks path scope violations when allowlist is configured', () => {
    const allowed = ['packages/**', 'tests/**'];
    expect(
      mergeBlockersFromFacts(openClean, checksSuccess, {
        allowed_paths: allowed,
        changed_paths: ['packages/remogram-core/foo.js'],
      }),
    ).toEqual([]);
    expect(
      mergeBlockersFromFacts(openClean, checksSuccess, {
        allowed_paths: allowed,
        changed_paths: ['topo/sdlc/foo.tg'],
      }),
    ).toEqual(['path_scope_violation']);
  });

  it('blocks when allowlist is configured but changed paths are unavailable', () => {
    expect(
      mergeBlockersFromFacts(openClean, checksSuccess, {
        allowed_paths: ['packages/**'],
        changed_paths: null,
      }),
    ).toEqual(['changed_paths_unavailable']);
  });

  it('skips path scope checks when allowlist is omitted', () => {
    expect(
      mergeBlockersFromFacts(openClean, checksSuccess, {
        changed_paths: ['topo/sdlc/foo.tg'],
      }),
    ).toEqual([]);
  });
});
