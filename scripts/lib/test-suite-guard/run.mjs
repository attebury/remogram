import { checkDiff } from './diff.mjs';
import { defaultRunGit } from './manifest.mjs';
import { checkManifest, checkManifestSubstance, resolveManifest } from './substance.mjs';

/** @param {string} repoRoot */
export function defaultBaseRef(repoRoot) {
  try {
    defaultRunGit(repoRoot, ['rev-parse', '--verify', 'origin/remo']);
    return 'origin/remo';
  } catch {
    return 'origin/main';
  }
}

/** @param {object} [options] */
export function runGuard(options = {}) {
  const repoRoot = options.repoRoot;
  const errors = [];

  const manifestResult = resolveManifest(repoRoot, options.manifest);
  if (!manifestResult.ok) {
    return manifestResult;
  }
  const manifest = manifestResult.manifest;
  const runGit = options.runGit ?? defaultRunGit;

  const manifestCheck = checkManifest(repoRoot, manifest);
  if (!manifestCheck.ok) errors.push(...manifestCheck.errors);

  const substanceResult = checkManifestSubstance(repoRoot, manifest);
  if (!substanceResult.ok) errors.push(...substanceResult.errors);

  const baseRef = options.base ?? defaultBaseRef(repoRoot);
  const headRef = options.head ?? 'HEAD';
  if (!options.skipDiff) {
    const diffResult = checkDiff(repoRoot, baseRef, headRef, manifest, runGit);
    if (!diffResult.ok) errors.push(...diffResult.errors);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
