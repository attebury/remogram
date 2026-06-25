import { describe, it, expect } from 'vitest';
import { classifyCheckReadFailure, withCheckReadRecovery } from '@remogram/core';
import { ERROR_CODES, forgeError } from '@remogram/core';

describe('check read recovery', () => {
  it('classifies timeout failures', () => {
    const recovery = classifyCheckReadFailure(new Error('request timeout'), { prNumber: 7 });
    expect(recovery?.failure_kind).toBe('timeout');
    expect(recovery?.retryable).toBe(true);
    expect(recovery?.recommended_recheck_command).toContain('7');
  });

  it('classifies 500 failures', () => {
    const recovery = classifyCheckReadFailure(
      Object.assign(new Error('server error'), { status: 500 }),
      { prNumber: 3 },
    );
    expect(recovery?.failure_kind).toBe('server_error');
  });

  it('returns null for non-recoverable errors', () => {
    expect(classifyCheckReadFailure(new Error('not found'), { prNumber: 1 })).toBeNull();
  });

  it('withCheckReadRecovery attaches recovery to forge error', () => {
    const base = forgeError(ERROR_CODES.API_ERROR, 'failed', 500);
    const recovery = classifyCheckReadFailure(
      Object.assign(new Error('timeout'), { status: 504 }),
      { prNumber: 2 },
    );
    const wrapped = withCheckReadRecovery(base, recovery);
    expect(wrapped.fields.recovery.failure_kind).toBe('timeout');
  });
});
