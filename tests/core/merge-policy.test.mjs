import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveMergePolicy,
  parseTruthyEnv,
  ALLOW_MISSING_CHECKS_ENV,
  ALLOW_PENDING_CHECKS_ENV,
} from '@remogram/core';

describe('parseTruthyEnv', () => {
  it('recognizes truthy and falsey literals', () => {
    expect(parseTruthyEnv('1')).toBe(true);
    expect(parseTruthyEnv('true')).toBe(true);
    expect(parseTruthyEnv('yes')).toBe(true);
    expect(parseTruthyEnv('0')).toBe(false);
    expect(parseTruthyEnv('false')).toBe(false);
    expect(parseTruthyEnv('')).toBe(null);
    expect(parseTruthyEnv('maybe')).toBe(null);
  });
});

describe('resolveMergePolicy', () => {
  afterEach(() => {
    delete process.env[ALLOW_MISSING_CHECKS_ENV];
    delete process.env[ALLOW_PENDING_CHECKS_ENV];
  });

  it('defaults both flags to false', () => {
    expect(resolveMergePolicy({})).toEqual({
      allow_missing_checks: false,
      allow_pending_checks: false,
      source: {
        allow_missing_checks: 'default',
        allow_pending_checks: 'default',
      },
    });
  });

  it('reads merge_policy from config', () => {
    expect(
      resolveMergePolicy({
        merge_policy: {
          allow_missing_checks: true,
          allow_pending_checks: true,
        },
      }),
    ).toEqual({
      allow_missing_checks: true,
      allow_pending_checks: true,
      source: {
        allow_missing_checks: 'config',
        allow_pending_checks: 'config',
      },
    });
  });

  it('env truthy overrides config for each flag independently', () => {
    process.env[ALLOW_MISSING_CHECKS_ENV] = '1';
    expect(
      resolveMergePolicy({
        merge_policy: { allow_missing_checks: false, allow_pending_checks: true },
      }).allow_missing_checks,
    ).toBe(true);
    expect(
      resolveMergePolicy({
        merge_policy: { allow_missing_checks: false, allow_pending_checks: true },
      }).source.allow_missing_checks,
    ).toBe('env');
  });

  it('env falsey falls back to config', () => {
    process.env[ALLOW_MISSING_CHECKS_ENV] = '0';
    expect(
      resolveMergePolicy({
        merge_policy: { allow_missing_checks: true },
      }),
    ).toMatchObject({
      allow_missing_checks: true,
      source: { allow_missing_checks: 'config' },
    });
  });
});
