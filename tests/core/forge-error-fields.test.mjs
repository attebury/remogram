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
      normalizeForgeErrorFields(ERROR_CODES.STALE_HEAD, {
        idempotency_scan: { pages: 1, max_pages: 50, page_size: 100 },
      }),
    ).toThrow(/does not allow trusted fields/);
  });

  it('allows check read recovery on api_error', () => {
    const fields = normalizeForgeErrorFields(ERROR_CODES.API_ERROR, {
      recovery: {
        failure_kind: 'timeout',
        retryable: true,
        recommended_recheck_command: 'remogram pr checks --number 1 --json',
        diagnostic_summary: 'timeout',
      },
    });
    expect(fields?.recovery?.failure_kind).toBe('timeout');
  });

  it('allows operator bind diagnostics for config_invalid', () => {
    const fields = normalizeForgeErrorFields(ERROR_CODES.CONFIG_INVALID, {
      reason: 'operator_bind_mismatch',
      field: 'remote',
      expected: 'origin',
      actual: 'gitea',
      remediation: 'Update operator config bind.',
    });
    expect(fields?.field).toBe('remote');
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

  it('allows inventory_list for inventory_list_incomplete', () => {
    const fields = normalizeForgeErrorFields(ERROR_CODES.INVENTORY_LIST_INCOMPLETE, {
      inventory_list: { entry_count: 5000 },
    });
    expect(fields).toEqual({ inventory_list: { entry_count: 5000 } });
  });

  it('exports allowlist for inventory_list_incomplete', () => {
    expect(FORGE_ERROR_FIELD_ALLOWLIST[ERROR_CODES.INVENTORY_LIST_INCOMPLETE]).toEqual([
      'inventory_list',
    ]);
  });
});
