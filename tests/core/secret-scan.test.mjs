import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createGitHelpers } from '../../scripts/lib/secret-scan-base.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

function git(dir, args) {
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
}

function setupRepoWithOriginMain() {
  const dir = mkdtempSync(join(tmpdir(), 'remogram-secret-scan-'));
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

function setupRepoWithOriginRemoOnly() {
  const dir = mkdtempSync(join(tmpdir(), 'remogram-secret-scan-'));
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

function gitRevParse(dir, ref) {
  return execFileSync('git', ['rev-parse', ref], { cwd: dir, encoding: 'utf8' }).trim();
}

describe('security:secrets gate', () => {
  /** @type {string[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) rmSync(cleanups.pop(), { recursive: true, force: true });
  });

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

  it('resolveAutomaticBaseRef selects origin/main in a temp repo', () => {
    const dir = setupRepoWithOriginMain();
    cleanups.push(dir);
    const { resolveAutomaticBaseRef } = createGitHelpers(dir);
    expect(resolveAutomaticBaseRef({})).toBe('origin/main');
  });

  it('resolveAutomaticBaseRef skips origin/remo when only main exists', () => {
    const dir = setupRepoWithOriginMain();
    cleanups.push(dir);
    git(dir, ['update-ref', 'refs/remotes/origin/remo', gitRevParse(dir, 'main')]);
    const { resolveAutomaticBaseRef } = createGitHelpers(dir);
    expect(resolveAutomaticBaseRef({})).toBe('origin/main');
    expect(resolveAutomaticBaseRef({})).not.toBe('origin/remo');
  });

  it('resolveAutomaticBaseRef returns null when only origin/remo exists', () => {
    const dir = setupRepoWithOriginRemoOnly();
    cleanups.push(dir);
    const { resolveAutomaticBaseRef } = createGitHelpers(dir);
    expect(resolveAutomaticBaseRef({})).toBeNull();
  });
});

describe('secret-scan workflow', () => {
  it('installs gitleaks without sudo or /usr/local/bin', () => {
    const workflow = readFileSync(join(repoRoot, '.github/workflows/secret-scan.yml'), 'utf8');
    expect(workflow).toMatch(/RUNNER_TEMP/);
    expect(workflow).toMatch(/GITHUB_PATH/);
    expect(workflow).toMatch(/command -v gitleaks/);
    expect(workflow).toMatch(/Linux:arm64\) asset="linux_arm64"/);
    expect(workflow).not.toMatch(/sudo install/);
    expect(workflow).not.toMatch(/\/usr\/local\/bin\/gitleaks/);
  });

  it('keeps direct security:secrets scan steps for PR push and dispatch', () => {
    const workflow = readFileSync(join(repoRoot, '.github/workflows/secret-scan.yml'), 'utf8');
    expect(workflow).toMatch(/GITLEAKS_VERSION:\s+v8\.30\.1/);
    expect(workflow).toMatch(/curl -sSfL/);
    expect(workflow).toMatch(/gitleaks version/);
    expect(workflow).toContain(
      'run: npm run security:secrets -- --base "origin/${{ github.base_ref }}" --head HEAD',
    );
    expect(workflow).toContain('github.event.before');
    expect(workflow).toContain('npm run security:secrets -- --full-history');
    expect(workflow).not.toMatch(/gitleaks\/gitleaks-action/);
    expect(workflow).not.toMatch(/GITHUB_TOKEN/);
    expect(workflow).not.toMatch(/GITLEAKS_ENABLE_UPLOAD_ARTIFACT/);
  });
});
