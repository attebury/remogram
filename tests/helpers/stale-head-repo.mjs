import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultTestConfig } from './mock-provider.mjs';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

export function setupRepoWithRemoteBranch() {
  const dir = mkdtempSync(join(tmpdir(), 'remogram-stale-head-'));
  writeFileSync(
    join(dir, '.remogram.json'),
    `${JSON.stringify(defaultTestConfig(), null, 2)}\n`,
  );
  git(dir, ['init', '--template=']);
  git(dir, ['config', 'user.email', 'test@remogram.local']);
  git(dir, ['config', 'user.name', 'remogram-test']);
  writeFileSync(join(dir, 'README.md'), 'base\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'base']);
  git(dir, ['checkout', '-b', 'feat']);
  writeFileSync(join(dir, 'README.md'), 'feat\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'feat']);
  const localSha = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['update-ref', 'refs/remotes/origin/feat', localSha]);
  git(dir, ['remote', 'add', 'origin', 'http://localhost:3000/owner/repo.git']);
  return {
    dir,
    localSha,
    staleForgeSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
