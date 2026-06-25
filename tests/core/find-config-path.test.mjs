import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, afterEach } from 'vitest';
import { findConfigPath, loadConfig, ERROR_CODES } from '@remogram/core';

function git(cwd, args) {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

function initRepo(dir) {
  git(dir, ['init', '--template=']);
  git(dir, ['config', 'user.email', 'test@remogram.local']);
  git(dir, ['config', 'user.name', 'remogram-test']);
  writeFileSync(join(dir, 'README.md'), 'test\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'init']);
}

const sampleConfig = {
  version: '1',
  provider: 'gitea-api',
  owner: 'owner',
  repo: 'repo',
  baseUrl: 'http://localhost:3000',
  remote: 'origin',
};

describe('findConfigPath', () => {
  /** @type {string[]} */
  const cleanupDirs = [];

  afterEach(() => {
    while (cleanupDirs.length) rmSync(cleanupDirs.pop(), { recursive: true, force: true });
  });

  function tempRoot(label) {
    const dir = mkdtempSync(join(tmpdir(), `remogram-config-${label}-`));
    cleanupDirs.push(dir);
    return dir;
  }

  it('finds .remogram.json at repo root from a nested cwd', () => {
    const root = tempRoot('nested-in-repo');
    initRepo(root);
    writeFileSync(join(root, '.remogram.json'), `${JSON.stringify(sampleConfig)}\n`);
    git(root, ['add', '.remogram.json']);
    git(root, ['commit', '-m', 'add config']);

    const nested = join(root, 'packages', 'remogram-core');
    mkdirSync(nested, { recursive: true });

    expect(findConfigPath(nested)).toBe(join(root, '.remogram.json'));
  });

  it('does not walk past git root to a parent-directory config', () => {
    const parent = tempRoot('parent-outside');
    writeFileSync(join(parent, '.remogram.json'), `${JSON.stringify(sampleConfig)}\n`);

    const repo = join(parent, 'repo');
    mkdirSync(repo);
    initRepo(repo);

    const nested = join(repo, 'src', 'nested');
    mkdirSync(nested, { recursive: true });

    expect(findConfigPath(nested)).toBeNull();
    try {
      loadConfig(nested);
      throw new Error('expected CONFIG_NOT_FOUND');
    } catch (err) {
      expect(err.forgeError.code).toBe(ERROR_CODES.CONFIG_NOT_FOUND);
    }
  });

  it('does not walk parent directories when cwd is outside any git repo', () => {
    const parent = tempRoot('non-git-parent');
    writeFileSync(join(parent, '.remogram.json'), `${JSON.stringify(sampleConfig)}\n`);

    const nested = join(parent, 'no-git', 'nested');
    mkdirSync(nested, { recursive: true });

    expect(findConfigPath(nested)).toBeNull();
  });

  it('finds config in cwd when outside any git repo', () => {
    const dir = tempRoot('non-git-local');
    writeFileSync(join(dir, '.remogram.json'), `${JSON.stringify(sampleConfig)}\n`);

    expect(findConfigPath(dir)).toBe(join(dir, '.remogram.json'));
  });
});
