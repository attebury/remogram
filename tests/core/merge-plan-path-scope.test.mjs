import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  gitDiffNameOnly,
  buildMergePlanBodyFromFacts,
  resolveMergePlanPathScope,
  applyForgePathScopeForMergePlan,
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

  it('resolveMergePlanPathScope does not use local git when allowlist is set without forge paths', () => {
    const scope = resolveMergePlanPathScope({
      allowed_paths: ['packages/**', 'tests/**'],
    });
    expect(scope.changed_paths).toBeNull();
  });

  it('resolveMergePlanPathScope uses forge changed_paths override', () => {
    const scope = resolveMergePlanPathScope({
      allowed_paths: ['packages/**', 'tests/**'],
      changed_paths: ['packages/remogram-core/foo.js'],
    });
    expect(scope.changed_paths).toEqual(['packages/remogram-core/foo.js']);
  });

  it('applyForgePathScopeForMergePlan sets null on paths_truncated', () => {
    const opts = { allowed_paths: ['packages/**'] };
    const applied = applyForgePathScopeForMergePlan(opts, {
      changed_paths: ['packages/foo.js'],
      paths_truncated: true,
    });
    expect(applied.changed_paths).toBeNull();
  });

  it('applyForgePathScopeForMergePlan passes complete forge paths', () => {
    const opts = { allowed_paths: ['packages/**'] };
    const applied = applyForgePathScopeForMergePlan(opts, {
      changed_paths: ['packages/foo.js'],
      paths_truncated: false,
    });
    expect(applied.changed_paths).toEqual(['packages/foo.js']);
  });

  it('buildMergePlanBodyFromFacts allows in-scope forge changed paths', () => {
    const view = {
      pr_number: 1,
      mergeability: 'clean',
      state: 'open',
      base_sha: baseSha,
      head_sha: headSha,
    };
    const checks = { check_conclusion: 'success', checks_truncated: false };
    const body = buildMergePlanBodyFromFacts(view, checks, {
      allowed_paths: ['packages/**', 'tests/**'],
      changed_paths: ['packages/remogram-core/foo.js'],
    });
    expect(body.blockers).toEqual([]);
  });

  it('buildMergePlanBodyFromFacts blocks when forge paths unavailable with allowlist', () => {
    const view = {
      pr_number: 1,
      mergeability: 'clean',
      state: 'open',
      base_sha: baseSha,
      head_sha: headSha,
    };
    const checks = { check_conclusion: 'success', checks_truncated: false };
    const body = buildMergePlanBodyFromFacts(view, checks, {
      allowed_paths: ['packages/**', 'tests/**'],
      changed_paths: null,
    });
    expect(body.blockers).toContain('changed_paths_unavailable');
  });

  it('buildMergePlanBodyFromFacts blocks out-of-scope paths', () => {
    const view = {
      pr_number: 2,
      mergeability: 'clean',
      state: 'open',
      base_sha: baseSha,
      head_sha: headSha,
    };
    const checks = { check_conclusion: 'success', checks_truncated: false };
    const body = buildMergePlanBodyFromFacts(view, checks, {
      allowed_paths: ['packages/**', 'tests/**'],
      changed_paths: ['topo/sdlc/out.tg'],
    });
    expect(body.blockers).toContain('path_scope_violation');
  });

  it('buildMergePlanBodyFromFacts blocks forge paths with .. segments as unavailable', () => {
    const view = {
      pr_number: 3,
      mergeability: 'clean',
      state: 'open',
      base_sha: baseSha,
      head_sha: headSha,
    };
    const checks = { check_conclusion: 'success', checks_truncated: false };
    const opts = { allowed_paths: ['packages/**', 'tests/**'] };
    const scoped = applyForgePathScopeForMergePlan(opts, {
      changed_paths: ['packages/../../topo/sdlc/out.tg'],
      paths_truncated: false,
      path_count: 1,
    });
    expect(scoped.changed_paths).toBeNull();
    const body = buildMergePlanBodyFromFacts(view, checks, scoped);
    expect(body.blockers).toContain('changed_paths_unavailable');
    expect(body.blockers).not.toContain('path_scope_violation');
  });

  it('buildMergePlanBodyFromFacts blocks interior .. laundering paths as unavailable', () => {
    const view = {
      pr_number: 5,
      mergeability: 'clean',
      state: 'open',
      base_sha: baseSha,
      head_sha: headSha,
    };
    const checks = { check_conclusion: 'success', checks_truncated: false };
    const body = buildMergePlanBodyFromFacts(view, checks, {
      allowed_paths: ['packages/**'],
      changed_paths: ['topo/../packages/foo.js'],
    });
    expect(body.blockers).toContain('changed_paths_unavailable');
    expect(body.blockers).not.toContain('path_scope_violation');
  });

  it('buildMergePlanBodyFromFacts blocks unnormalizable direct changed_paths as unavailable', () => {
    const view = {
      pr_number: 4,
      mergeability: 'clean',
      state: 'open',
      base_sha: baseSha,
      head_sha: headSha,
    };
    const checks = { check_conclusion: 'success', checks_truncated: false };
    const body = buildMergePlanBodyFromFacts(view, checks, {
      allowed_paths: ['packages/**', 'tests/**'],
      changed_paths: ['../outside'],
    });
    expect(body.blockers).toContain('changed_paths_unavailable');
    expect(body.blockers).not.toContain('path_scope_violation');
  });
});
