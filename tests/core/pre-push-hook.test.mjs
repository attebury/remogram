import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('install-pre-push-hook', () => {
  it('defaults BASE_REF to origin/main not origin/remo', () => {
    const script = readFileSync(join(repoRoot, 'scripts/install-pre-push-hook.sh'), 'utf8');
    expect(script).toMatch(/REMOGRAM_SECRET_SCAN_BASE_REF:-origin\/main/);
    expect(script).not.toMatch(/origin\/remo/);
  });
});
