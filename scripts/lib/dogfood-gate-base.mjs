import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Dogfood integration branch on local Gitea (canonical_integration_ref: origin/remo). */
export const DOGFOOD_INTEGRATION_BRANCH = 'remo';

const BASE_REF_CANDIDATES = [`origin/${DOGFOOD_INTEGRATION_BRANCH}`, 'origin/main'];

/** @param {string} repoRoot @param {string} ref */
function verifyRef(repoRoot, ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0;
}

/**
 * Resolve gate/scan base ref for Remogram dogfood: prefer origin/remo, fallback origin/main.
 * @param {string} repoRoot
 * @returns {string}
 */
export function resolveDogfoodGateBaseRef(repoRoot) {
  for (const ref of BASE_REF_CANDIDATES) {
    if (verifyRef(repoRoot, ref)) {
      return ref;
    }
  }
  return 'origin/main';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = process.argv[2] ?? process.cwd();
  process.stdout.write(`${resolveDogfoodGateBaseRef(repoRoot)}\n`);
}
