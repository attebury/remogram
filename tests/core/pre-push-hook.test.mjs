import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const installScript = join(repoRoot, 'scripts/install-pre-push-hook.sh');

describe('install-pre-push-hook', () => {
  /** @type {string[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) rmSync(cleanups.pop(), { recursive: true, force: true });
  });

  it('defaults BASE_REF to origin/main not origin/remo in script source', () => {
    const script = readFileSync(installScript, 'utf8');
    expect(script).toMatch(/REMOGRAM_SECRET_SCAN_BASE_REF:-origin\/main/);
    expect(script).not.toMatch(/origin\/remo/);
  });

  it('install script writes hook with origin/main base ref', () => {
    const dir = mkdtempSync(join(tmpdir(), 'remogram-pre-push-'));
    cleanups.push(dir);
    execFileSync('git', ['init', '--template='], { cwd: dir, stdio: 'pipe' });
    mkdirSync(join(dir, '.git/hooks'), { recursive: true });
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    const patched = readFileSync(installScript, 'utf8').replace(
      'REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"',
      `REPO_ROOT="${dir}"`,
    );
    const tempInstall = join(dir, 'scripts/install-pre-push-hook.sh');
    writeFileSync(tempInstall, patched, { mode: 0o755 });
    execFileSync('bash', [tempInstall], { cwd: dir, stdio: 'pipe' });
    const hook = readFileSync(join(dir, '.git/hooks/pre-push'), 'utf8');
    expect(hook).toContain('origin/main');
    expect(hook).not.toContain('origin/remo');
    expect(hook).toMatch(/--base "origin\/main"/);
  });
});
