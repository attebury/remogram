import { describe, it, expect } from 'vitest';
import {
  sanitizeReadField,
  sanitizeWriteBody,
  sanitizeWriteTitle,
  DEFAULT_FIELD_MAX_BYTES,
} from '@remogram/core';

describe('sanitizeWriteBody', () => {
  it('preserves newlines when uncapped', () => {
    const body = 'line one\nline two\nline three';
    const out = sanitizeWriteBody(body, { fieldMaxBytes: null });
    expect(out).toBe(body);
  });

  it('caps at default 512 bytes', () => {
    const body = 'x'.repeat(600);
    const out = sanitizeWriteBody(body);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(DEFAULT_FIELD_MAX_BYTES);
  });

  it('redacts secrets even when uncapped', () => {
    const out = sanitizeWriteBody('token ghp_abc123xyz here', { fieldMaxBytes: null });
    expect(out).not.toMatch(/ghp_abc123xyz/);
    expect(out).toContain('[REDACTED]');
  });
});

describe('sanitizeReadField', () => {
  it('still collapses newlines on read path', () => {
    expect(sanitizeReadField('hello\nworld')).toBe('hello world');
  });

  it('caps long read fields at 512', () => {
    const out = sanitizeReadField('y'.repeat(600));
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(DEFAULT_FIELD_MAX_BYTES);
  });
});

describe('sanitizeWriteTitle', () => {
  it('collapses newlines in titles', () => {
    expect(sanitizeWriteTitle('a\nb', { fieldMaxBytes: null })).toBe('a b');
  });
});
