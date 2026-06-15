import { spawnSync } from 'node:child_process';

const AUTOMATIC_BASE_CANDIDATES = (env = process.env) =>
  [
    env.REMOGRAM_SECRET_SCAN_BASE_REF,
    env.TOPOGRAM_SECRET_SCAN_BASE_REF,
    env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : null,
    'origin/main',
  ].filter(Boolean);

export function createGitHelpers(repoRoot) {
  function runGit(args) {
    return spawnSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  function resolveCommit(ref, { required = false } = {}) {
    const result = runGit(['rev-parse', '--verify', `${ref}^{commit}`]);
    if (result.status === 0) {
      return result.stdout.trim();
    }
    if (!required) {
      return null;
    }
    const diagnostic = (result.stderr || result.stdout || '').trim();
    throw new Error(
      [`Unable to resolve git ref ${ref}.`, diagnostic].filter(Boolean).join('\n'),
    );
  }

  function resolveAutomaticBaseRef(env = process.env) {
    for (const candidate of AUTOMATIC_BASE_CANDIDATES(env)) {
      if (resolveCommit(candidate, { required: false })) {
        return candidate;
      }
    }
    return null;
  }

  return { runGit, resolveCommit, resolveAutomaticBaseRef };
}
