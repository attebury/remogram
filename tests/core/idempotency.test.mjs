import { describe, it, expect, afterEach } from 'vitest';
import {
  normalizeIdempotencyKey,
  idempotencyFingerprint,
  bindIdempotencyScope,
  idempotencyPacketFields,
  resetIdempotencyScopeBindings,
  ERROR_CODES,
} from '@remogram/core';

describe('idempotency keys', () => {
  afterEach(() => {
    resetIdempotencyScopeBindings();
  });

  it('normalizeIdempotencyKey accepts agent-safe charset', () => {
    expect(normalizeIdempotencyKey('agent.retry-1')).toBe('agent.retry-1');
  });

  it('normalizeIdempotencyKey rejects empty and invalid keys', () => {
    expect(normalizeIdempotencyKey(null)).toBeNull();
    expect(() => normalizeIdempotencyKey('bad key')).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({ code: ERROR_CODES.INVALID_ARGS }),
      }),
    );
  });

  it('idempotencyFingerprint is stable for key and scope', () => {
    const a = idempotencyFingerprint('retry-1', ['impl/x', 'remo']);
    const b = idempotencyFingerprint('retry-1', ['impl/x', 'remo']);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
  });

  it('idempotencyFingerprint differs when scope differs', () => {
    const a = idempotencyFingerprint('retry-1', ['impl/x', 'remo']);
    const b = idempotencyFingerprint('retry-1', ['impl/y', 'remo']);
    expect(a).not.toBe(b);
  });

  it('bindIdempotencyScope returns fingerprint and rejects scope conflict', () => {
    const repoId = 'owner/repo';
    const fp1 = bindIdempotencyScope(repoId, 'agent-key', ['impl/a', 'remo']);
    const fp2 = bindIdempotencyScope(repoId, 'agent-key', ['impl/a', 'remo']);
    expect(fp2).toBe(fp1);
    expect(() => bindIdempotencyScope(repoId, 'agent-key', ['impl/b', 'remo'])).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({ code: ERROR_CODES.IDEMPOTENCY_CONFLICT }),
      }),
    );
  });

  it('idempotencyPacketFields emits fingerprint without raw key', () => {
    const fields = idempotencyPacketFields('abc123def4567890', { reusedExisting: true });
    expect(fields).toEqual({
      idempotency_fingerprint: 'abc123def4567890',
      reused_existing: true,
    });
    expect(JSON.stringify(fields)).not.toContain('agent-key');
  });

  it('idempotencyPacketFields sets created on new writes', () => {
    expect(idempotencyPacketFields('fp1', { reusedExisting: false })).toEqual({
      idempotency_fingerprint: 'fp1',
      created: true,
    });
  });

  it('idempotencyPacketFields can flag ambiguous_after_write', () => {
    expect(
      idempotencyPacketFields('fp1', { reusedExisting: false, ambiguousAfterWrite: true }),
    ).toEqual({
      idempotency_fingerprint: 'fp1',
      created: true,
      ambiguous_after_write: true,
    });
  });
});
