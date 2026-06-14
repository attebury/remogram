import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('security:secrets gate', () => {
  it('documents the branch-range CLI contract', () => {
    const script = readFileSync(join(repoRoot, 'scripts/run-secret-scan.mjs'), 'utf8');
    expect(script).toMatch(/Usage: npm run security:secrets -- \[--base <ref>\] \[--head <ref>\] \[--full-history\]/);
    expect(script).toMatch(/REMOGRAM_SECRET_SCAN_BASE_REF/);
    expect(script).toMatch(/origin\/main/);
    expect(script).not.toMatch(/origin\/remo/);
    expect(script).toMatch(/\.gitleaks\.toml/);
    expect(script).toMatch(/had no merge base with/);
  });

  it('prints help without requiring gitleaks when --help is passed', () => {
    const result = spawnSync(process.execPath, [join(repoRoot, 'scripts/run-secret-scan.mjs'), '--help'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('npm run security:secrets');
    expect(result.stdout).toContain('--full-history');
  });

  it('keeps gitleaks config and ignore files present', () => {
    expect(readFileSync(join(repoRoot, '.gitleaks.toml'), 'utf8')).toContain('Remogram Gitleaks configuration');
    expect(readFileSync(join(repoRoot, '.gitleaksignore'), 'utf8')).toContain('historical false-positive baseline');
  });
});
