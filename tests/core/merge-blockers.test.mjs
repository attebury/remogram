import { describe, it, expect } from 'vitest';
import { mergeBlockersFromFacts } from '@remogram/core';

describe('mergeBlockersFromFacts', () => {
  const openClean = { mergeability: 'clean', state: 'open' };
  const checksSuccess = { check_conclusion: 'success' };

  it('returns no blockers on the happy path', () => {
    expect(mergeBlockersFromFacts(openClean, checksSuccess)).toEqual([]);
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
});
