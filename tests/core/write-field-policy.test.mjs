import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveEffectiveWriteFieldPolicy,
  getEffectiveWriteFieldMaxBytesFromEnv,
  parseForgeWritePolicyBlock,
  WRITE_FIELD_MAX_BYTES_ENV,
  DEFAULT_FIELD_MAX_BYTES,
} from '@remogram/core';

describe('write field policy', () => {
  afterEach(() => {
    delete process.env[WRITE_FIELD_MAX_BYTES_ENV];
  });

  it('defaults to 512 bytes when unset', () => {
    const policy = resolveEffectiveWriteFieldPolicy({}, {});
    expect(policy.fieldMaxBytes).toBe(DEFAULT_FIELD_MAX_BYTES);
    expect(policy.uncapped).toBe(false);
    expect(policy.source).toBe('default');
  });

  it('honors repo forge_write_policy cap', () => {
    const policy = resolveEffectiveWriteFieldPolicy(
      { forge_write_policy: { field_max_bytes: 2048 } },
      {},
    );
    expect(policy.fieldMaxBytes).toBe(2048);
    expect(policy.source).toBe('repo');
  });

  it('operator overlay overrides repo cap', () => {
    const policy = resolveEffectiveWriteFieldPolicy(
      { forge_write_policy: { field_max_bytes: 2048 } },
      { config: { forge_write_policy: { field_max_bytes: null } } },
    );
    expect(policy.fieldMaxBytes).toBe(null);
    expect(policy.uncapped).toBe(true);
    expect(policy.source).toBe('operator');
  });

  it('parseForgeWritePolicyBlock accepts none sentinel', () => {
    expect(parseForgeWritePolicyBlock({ field_max_bytes: 'none' })).toBe(null);
  });

  it('env override wins over config', () => {
    process.env[WRITE_FIELD_MAX_BYTES_ENV] = '1024';
    const policy = resolveEffectiveWriteFieldPolicy(
      { forge_write_policy: { field_max_bytes: 2048 } },
      {},
    );
    expect(policy.fieldMaxBytes).toBe(1024);
    expect(policy.source).toBe('env');
    expect(policy.envOverride).toBe(true);
  });

  it('env none disables cap', () => {
    process.env[WRITE_FIELD_MAX_BYTES_ENV] = 'none';
    expect(getEffectiveWriteFieldMaxBytesFromEnv().bytes).toBe(null);
  });
});
