import { describe, it, expect } from 'vitest';
import {
  ERROR_CODES,
  normalizeForgeErrorFields,
  FORGE_ERROR_FIELD_ALLOWLIST,
} from '@remogram/core';

describe('normalizeForgeErrorFields', () => {
  it('allows idempotency_scan for idempotency_scan_incomplete', () => {
    const fields = normalizeForgeErrorFields(ERROR_CODES.IDEMPOTENCY_SCAN_INCOMPLETE, {
      idempotency_scan: { pages: 50, max_pages: 50, page_size: 100 },
    });
    expect(fields).toEqual({
      idempotency_scan: { pages: 50, max_pages: 50, page_size: 100 },
    });
  });

  it('rejects extra fields for allowlisted error codes', () => {
    expect(() =>
      normalizeForgeErrorFields(ERROR_CODES.IDEMPOTENCY_SCAN_INCOMPLETE, {
        idempotency_scan: { pages: 1, max_pages: 50, page_size: 100 },
        extra: true,
      }),
    ).toThrow(/not allowed/);
  });

  it('rejects trusted fields for codes without allowlist', () => {
    expect(() =>
      normalizeForgeErrorFields(ERROR_CODES.CONFIG_INVALID, {
        idempotency_scan: { pages: 1, max_pages: 50, page_size: 100 },
      }),
    ).toThrow(/does not allow trusted fields/);
  });

  it('rejects envelope override attempts', () => {
    expect(() =>
      normalizeForgeErrorFields(ERROR_CODES.IDEMPOTENCY_SCAN_INCOMPLETE, {
        idempotency_scan: { pages: 1, max_pages: 50, page_size: 100 },
        ok: true,
      }),
    ).toThrow(/cannot override packet field ok/);
  });

  it('rejects non-positive idempotency_scan integers', () => {
    expect(() =>
      normalizeForgeErrorFields(ERROR_CODES.IDEMPOTENCY_SCAN_INCOMPLETE, {
        idempotency_scan: { pages: 0, max_pages: 50, page_size: 100 },
      }),
    ).toThrow(/positive integer/);
  });

  it('exports allowlist for idempotency_scan_incomplete', () => {
    expect(FORGE_ERROR_FIELD_ALLOWLIST[ERROR_CODES.IDEMPOTENCY_SCAN_INCOMPLETE]).toEqual([
      'idempotency_scan',
    ]);
  });
});
