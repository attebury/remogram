import {
  validateManifestVersion,
  loadManifestAtRefResult,
  checkManifestShrink,
  resolveDiffPolicyForDiff,
  defaultRunGit,
} from './manifest.mjs';
import { MANIFEST_REL } from './constants.mjs';

/**
 * @param {string} repoRoot
 * @param {string} baseRef
 * @param {string} headRef
 * @param {object} manifest
 * @param {(cwd: string, args: string[]) => string} runGit
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function checkDiff(
  repoRoot,
  baseRef = 'origin/main',
  headRef = 'HEAD',
  manifest,
  runGit = defaultRunGit,
) {
  const errors = [];
  const versionResult = validateManifestVersion(manifest);
  if (!versionResult.ok) {
    errors.push(...versionResult.errors);
    return { ok: false, errors };
  }

  const baseManifestResult = loadManifestAtRefResult(repoRoot, baseRef, runGit);
  if (!baseManifestResult.ok) {
    return baseManifestResult;
  }
  const policyResult = resolveDiffPolicyForDiff(baseManifestResult.manifest.diff_policy);
  if (!policyResult.ok) return policyResult;
  const { churnThreshold, minRemoved } = policyResult;

  let numstat = '';
  try {
    numstat = runGit(repoRoot, ['diff', '--numstat', `${baseRef}..${headRef}`, '--', 'tests/']);
  } catch (err) {
    return {
      ok: false,
      errors: [`git diff --numstat failed (${baseRef}..${headRef}): ${err.message}`],
    };
  }

  let manifestChanged = false;
  try {
    const manifestDiff = runGit(repoRoot, [
      'diff',
      '--name-only',
      `${baseRef}..${headRef}`,
      '--',
      MANIFEST_REL,
    ]).trim();
    manifestChanged = manifestDiff.length > 0;
  } catch {
    manifestChanged = false;
  }

  if (manifestChanged) {
    const shrinkResult = checkManifestShrink(repoRoot, baseRef, headRef, runGit);
    if (!shrinkResult.ok) errors.push(...shrinkResult.errors);
  }

  const protectedPaths = new Set(Object.keys(manifest.protected_files ?? {}));
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue;
    const [added, removed, filePath] = line.split('\t');
    if (!protectedPaths.has(filePath)) continue;
    const addedN = Number(added) || 0;
    const removedN = Number(removed) || 0;
    const churn = addedN + removedN;

    if (removedN > addedN) {
      errors.push(`${filePath}: net deletion (${removedN} removed, ${addedN} added)`);
    }
    if (churn >= churnThreshold) {
      errors.push(`${filePath}: churn ${churn} lines (>= ${churnThreshold})`);
    }
    if (removedN >= minRemoved) {
      errors.push(`${filePath}: ${removedN} lines removed (>= ${minRemoved})`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
