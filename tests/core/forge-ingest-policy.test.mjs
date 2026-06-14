import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_CHECK_STATUS_PAGE_SIZE,
  MAX_CHECK_STATUS_PAGES,
  DEFAULT_OPEN_PULL_LIST_PAGE_SIZE,
  MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
  FORGE_INGEST_MAX_BYTES_ENV,
  forgeIngestCapabilityFacts,
  checkPaginationCapabilityFacts,
  getEffectiveIngestMaxBytes,
} from '@remogram/core';

const repoRoot = join(import.meta.dirname, '../..');

describe('forge ingest cap policy', () => {
  afterEach(() => {
    delete process.env[FORGE_INGEST_MAX_BYTES_ENV];
  });

  it('defaults to 8192 bytes', () => {
    expect(getEffectiveIngestMaxBytes()).toEqual({ bytes: 8192, envOverride: false });
    expect(forgeIngestCapabilityFacts()).toEqual({ forge_ingest_cap_bytes: 8192 });
    expect(DEFAULT_MAX_BYTES).toBe(8192);
  });

  it('honors REMOGRAM_FORGE_INGEST_MAX_BYTES when valid', () => {
    process.env[FORGE_INGEST_MAX_BYTES_ENV] = '4096';
    expect(getEffectiveIngestMaxBytes()).toEqual({ bytes: 4096, envOverride: true });
    expect(forgeIngestCapabilityFacts()).toEqual({ forge_ingest_cap_bytes: 4096 });
  });

  it('falls back when env override is invalid', () => {
    process.env[FORGE_INGEST_MAX_BYTES_ENV] = 'not-a-number';
    expect(getEffectiveIngestMaxBytes()).toEqual({
      bytes: 8192,
      envOverride: false,
      invalidEnv: true,
    });
  });

  it('exports shared check pagination constants', () => {
    expect(DEFAULT_CHECK_STATUS_PAGE_SIZE).toBe(25);
    expect(MAX_CHECK_STATUS_PAGES).toBe(50);
  });

  it('exports open-pull idempotency pagination constants decoupled from check status', () => {
    expect(DEFAULT_OPEN_PULL_LIST_PAGE_SIZE).toBe(100);
    expect(MAX_OPEN_PULL_IDEMPOTENCY_PAGES).toBe(50);
  });

  it('checkPaginationCapabilityFacts describes offset_limit strategy', () => {
    expect(checkPaginationCapabilityFacts({ strategy: 'offset_limit', pageSizeParam: 'limit' })).toEqual({
      check_pagination: {
        strategy: 'offset_limit',
        page_size: 25,
        max_pages: 50,
        page_size_param: 'limit',
        ingest_backoff: 'halve_until_fit',
        on_page_cap: 'set_checks_truncated',
        compliant_max_items_per_source: 1250,
        check_source_count: 1,
        truncation_combination: 'single_source',
        compliant_max_items_total: 1250,
        truncation_packet_field: 'checks_truncated',
      },
    });
  });

  it('checkPaginationCapabilityFacts describes dual-source totals', () => {
    expect(
      checkPaginationCapabilityFacts({
        strategy: 'link_header',
        pageSizeParam: 'per_page',
        sourceCount: 2,
      }),
    ).toEqual({
      check_pagination: {
        strategy: 'link_header',
        page_size: 25,
        max_pages: 50,
        page_size_param: 'per_page',
        ingest_backoff: 'halve_until_fit',
        on_page_cap: 'set_checks_truncated',
        compliant_max_items_per_source: 1250,
        check_source_count: 2,
        truncation_combination: 'any_source_truncated',
        compliant_max_items_total: 2500,
        truncation_packet_field: 'checks_truncated',
      },
    });
  });
});

describe('SHA-bound language precision', () => {
  const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
  const skill = readFileSync(
    join(repoRoot, 'tools/remogram-agent-support/skills/remogram-core/SKILL.md'),
    'utf8',
  );

  it('README distinguishes git-resolved refs from forge-reported PR SHAs', () => {
    expect(readme).toMatch(/git-resolved/i);
    expect(readme).toMatch(/forge-reported/i);
  });

  it('README describes PR-by-number reconciliation and stale_head', () => {
    expect(readme).toMatch(/reconciliation/i);
    expect(readme).toMatch(/stale_head/i);
  });

  it('remogram-core skill distinguishes git-resolved refs from forge-reported PR SHAs', () => {
    expect(skill).toMatch(/git-resolved/i);
    expect(skill).toMatch(/forge-reported/i);
  });

  it('remogram-core skill describes PR-by-number reconciliation', () => {
    expect(skill).toMatch(/reconciliation/i);
    expect(skill).toMatch(/stale_head/i);
  });
});
