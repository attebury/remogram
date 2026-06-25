import { describe, it, expect } from 'vitest';
import {
  reconcileMergeEffectAfterError,
  buildCrMergeIndeterminateBody,
} from '@remogram/core';

describe('merge effect reconciler', () => {
  const head = 'a'.repeat(40);
  const base = 'b'.repeat(40);
  const advanced = 'c'.repeat(40);

  it('marks retry_safe when branch unchanged', () => {
    const result = reconcileMergeEffectAfterError({
      expectedHeadSha: head,
      expectedBaseSha: base,
      beforeBaseSha: base,
      targetBranchSha: base,
      prState: 'open',
    });
    expect(result.retry_safe).toBe(true);
    expect(result.partial_success_suspected).toBe(false);
  });

  it('marks indeterminate when target branch advanced', () => {
    const result = reconcileMergeEffectAfterError({
      expectedHeadSha: head,
      expectedBaseSha: base,
      beforeBaseSha: base,
      targetBranchSha: advanced,
      prState: 'open',
    });
    expect(result.retry_safe).toBe(false);
    expect(result.partial_success_suspected).toBe(true);
    expect(result.status).toBe('target_branch_advanced');
  });

  it('buildCrMergeIndeterminateBody includes reconciliation', () => {
    const reconciliation = reconcileMergeEffectAfterError({
      expectedHeadSha: head,
      expectedBaseSha: base,
      beforeBaseSha: base,
      targetBranchSha: advanced,
    });
    const body = buildCrMergeIndeterminateBody({
      prNumber: 9,
      expected: { baseSha: base, headSha: head },
      before: { base_sha: base, head_sha: head },
      reconciliation,
      endpointError: { code: 'merge_endpoint_failed', message: 'timeout', status: 504 },
    });
    expect(body.post_error_reconciliation.retry_safe).toBe(false);
    expect(body.change_request.number).toBe(9);
  });
});
