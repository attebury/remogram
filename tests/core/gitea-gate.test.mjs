import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import {
  DOGFOOD_INTEGRATION_BRANCH,
  resolveDogfoodGateBaseRef,
} from '../../scripts/lib/dogfood-gate-base.mjs';
import { defaultBaseRef } from '../../scripts/check-test-append-only.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const giteaWorkflowPath = join(repoRoot, '.gitea/workflows/ci-gate.yml');
const giteaGateScriptPath = join(repoRoot, 'scripts/run-gitea-gate.sh');
// Public export strips dogfood Gitea gate paths; contract tests are maintainer-only.
const describeDogfoodGateContract = existsSync(giteaWorkflowPath) ? describe : describe.skip;

function git(dir, args) {
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
}

function gitRevParse(dir, ref) {
  return execFileSync('git', ['rev-parse', ref], { cwd: dir, encoding: 'utf8' }).trim();
}

function setupRepoWithOriginRemo() {
  const dir = mkdtempSync(join(tmpdir(), 'remogram-gate-remo-'));
  git(dir, ['init', '--template=']);
  git(dir, ['config', 'user.email', 'test@remogram.local']);
  git(dir, ['config', 'user.name', 'remogram-test']);
  writeFileSync(join(dir, 'README.md'), 'init\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['branch', '-M', 'remo']);
  git(dir, ['update-ref', 'refs/remotes/origin/remo', gitRevParse(dir, 'remo')]);
  return dir;
}

function setupRepoWithOriginMainOnly() {
  const dir = mkdtempSync(join(tmpdir(), 'remogram-gate-main-'));
  git(dir, ['init', '--template=']);
  git(dir, ['config', 'user.email', 'test@remogram.local']);
  git(dir, ['config', 'user.name', 'remogram-test']);
  writeFileSync(join(dir, 'README.md'), 'init\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['branch', '-M', 'main']);
  git(dir, ['update-ref', 'refs/remotes/origin/main', gitRevParse(dir, 'main')]);
  return dir;
}

describe('dogfood gate base resolver', () => {
  /** @type {string[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) rmSync(cleanups.pop(), { recursive: true, force: true });
  });

  it('exports remo as dogfood integration branch', () => {
    expect(DOGFOOD_INTEGRATION_BRANCH).toBe('remo');
  });

  it('resolveDogfoodGateBaseRef prefers origin/remo (P1)', () => {
    const dir = setupRepoWithOriginRemo();
    cleanups.push(dir);
    expect(resolveDogfoodGateBaseRef(dir)).toBe('origin/remo');
  });

  it('resolveDogfoodGateBaseRef falls back to origin/main (N1)', () => {
    const dir = setupRepoWithOriginMainOnly();
    cleanups.push(dir);
    expect(resolveDogfoodGateBaseRef(dir)).toBe('origin/main');
  });

  it('matches defaultBaseRef preference order (X1)', () => {
    const remoDir = setupRepoWithOriginRemo();
    cleanups.push(remoDir);
    expect(resolveDogfoodGateBaseRef(remoDir)).toBe(defaultBaseRef(remoDir));

    const mainDir = setupRepoWithOriginMainOnly();
    cleanups.push(mainDir);
    expect(resolveDogfoodGateBaseRef(mainDir)).toBe(defaultBaseRef(mainDir));
  });
});

describeDogfoodGateContract('gitea ci-gate workflow contract', () => {
  it('uses origin/remo for push and manual, not origin/main (P2, N2)', () => {
    const workflow = readFileSync(join(repoRoot, '.gitea/workflows/ci-gate.yml'), 'utf8');
    expect(workflow).toContain('REMOGRAM_DOGFOOD_INTEGRATION_BRANCH: remo');
    expect(workflow).toContain('Fetch integration base (push)');
    expect(workflow).toContain('Fetch integration base (manual)');
    expect(workflow).toMatch(/DOGFOOD_GATE_BASE: origin\/\$\{\{ env\.REMOGRAM_DOGFOOD_INTEGRATION_BRANCH \}\}/);
    expect(workflow).not.toMatch(/DOGFOOD_GATE_BASE: origin\/main/);
    expect(workflow).toContain('DOGFOOD_GATE_BASE: origin/${{ gitea.base_ref }}');
  });
});

describeDogfoodGateContract('run-gitea-gate script contract', () => {
  it('resolves base via dogfood-gate-base when DOGFOOD_GATE_BASE unset (P3)', () => {
    const script = readFileSync(join(repoRoot, 'scripts/run-gitea-gate.sh'), 'utf8');
    expect(script).toContain('dogfood-gate-base.mjs');
    expect(script).not.toMatch(/DOGFOOD_GATE_BASE:-origin\/main/);
  });
});
