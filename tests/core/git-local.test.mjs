import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitRevParse, gitAheadBehind } from '@remogram/core';

function git(dir, args) {
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
}

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'remogram-git-local-'));
  git(dir, ['init', '--template=']);
  git(dir, ['config', 'user.email', 'test@remogram.local']);
  git(dir, ['config', 'user.name', 'remogram-test']);
  writeFileSync(join(dir, 'README.md'), 'init\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['branch', '-M', 'main']);
  git(dir, ['checkout', '-b', 'feature/x']);
  writeFileSync(join(dir, 'feature.txt'), 'x\n');
  git(dir, ['add', 'feature.txt']);
  git(dir, ['commit', '-m', 'feature']);
  git(dir, ['checkout', 'main']);
  return dir;
}

describe('git-local helpers', () => {
  /** @type {string[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) rmSync(cleanups.pop(), { recursive: true, force: true });
  });

  it('gitRevParse resolves branch refs', () => {
    const dir = setupRepo();
    cleanups.push(dir);
    expect(gitRevParse(dir, 'main')).toMatch(/^[0-9a-f]{40}$/);
    expect(gitRevParse(dir, 'feature/x')).toMatch(/^[0-9a-f]{40}$/);
  });

  it('gitRevParse rejects option injection refs', () => {
    const dir = setupRepo();
    cleanups.push(dir);
    expect(() => gitRevParse(dir, '--show-toplevel')).toThrow(/must not start with '-'/);
  });

  it('gitAheadBehind counts commits between refs', () => {
    const dir = setupRepo();
    cleanups.push(dir);
    const main = gitRevParse(dir, 'main');
    const feature = gitRevParse(dir, 'feature/x');
    expect(gitAheadBehind(dir, main, feature)).toEqual({ ahead_by: 1, behind_by: 0 });
  });
});
