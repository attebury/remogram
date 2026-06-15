import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  gitDiffNameOnly,
  buildMergePlanBodyFromFacts,
  resolveMergePlanPathScope,
} from '@remogram/core';

function git(cwd, args) {
  execFileSync('git', args, { cwd, encoding: 'utf8' });
}

describe('merge plan path scope', () => {
  let repoDir;
  let baseSha;
  let headSha;

  beforeAll(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remogram-merge-plan-'));
    git(repoDir, ['init']);
    git(repoDir, ['config', 'user.email', 'test@example.com']);
    git(repoDir, ['config', 'user.name', 'Test']);

    fs.writeFileSync(path.join(repoDir, 'README.md'), 'base\n');
    git(repoDir, ['add', 'README.md']);
    git(repoDir, ['commit', '-m', 'base']);
    baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();

    fs.mkdirSync(path.join(repoDir, 'packages/remogram-core'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'packages/remogram-core/foo.js'), 'export {};\n');
    git(repoDir, ['add', 'packages/remogram-core/foo.js']);
    git(repoDir, ['commit', '-m', 'add package file']);
    headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('gitDiffNameOnly lists changed paths between SHAs', () => {
    expect(gitDiffNameOnly(repoDir, baseSha, headSha)).toEqual(['packages/remogram-core/foo.js']);
  });

  it('resolveMergePlanPathScope diffs forge SHAs when allowlist is set', () => {
    const view = { base_sha: baseSha, head_sha: headSha };
    const scope = resolveMergePlanPathScope({ cwd: repoDir }, view, {
      allowed_paths: ['packages/**', 'tests/**'],
    });
    expect(scope.changed_paths).toEqual(['packages/remogram-core/foo.js']);
  });

  it('buildMergePlanBodyFromFacts allows in-scope package changes', () => {
    const view = {
      pr_number: 1,
      mergeability: 'clean',
      state: 'open',
      base_sha: baseSha,
      head_sha: headSha,
    };
    const checks = { check_conclusion: 'success', checks_truncated: false };
    const body = buildMergePlanBodyFromFacts({ cwd: repoDir }, view, checks, {
      allowed_paths: ['packages/**', 'tests/**'],
    });
    expect(body.blockers).toEqual([]);
  });

  it('buildMergePlanBodyFromFacts blocks out-of-scope paths', () => {
    fs.mkdirSync(path.join(repoDir, 'topo/sdlc'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'topo/sdlc/out.tg'), 'task t {}\n');
    git(repoDir, ['add', 'topo/sdlc/out.tg']);
    git(repoDir, ['commit', '-m', 'add topo file']);
    const outHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();

    const view = {
      pr_number: 2,
      mergeability: 'clean',
      state: 'open',
      base_sha: headSha,
      head_sha: outHead,
    };
    const checks = { check_conclusion: 'success', checks_truncated: false };
    const body = buildMergePlanBodyFromFacts({ cwd: repoDir }, view, checks, {
      allowed_paths: ['packages/**', 'tests/**'],
    });
    expect(body.blockers).toContain('path_scope_violation');
  });
});
