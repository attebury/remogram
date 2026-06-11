import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_MAX_BYTES,
  FORGE_INGEST_MAX_BYTES_ENV,
  forgeIngestCapabilityFacts,
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
