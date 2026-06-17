import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MANIFEST_REL, SUPPORTED_MANIFEST_VERSION } from './constants.mjs';

/** @param {string} cwd @param {string[]} args */
export function defaultRunGit(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function parseErrorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * @param {string} raw
 * @returns {{ ok: true, manifest: object } | { ok: false, errors: string[] }}
 */
export function parseManifestJson(raw) {
  try {
    return { ok: true, manifest: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, errors: [`manifest parse failed: ${parseErrorMessage(err)}`] };
  }
}

/** @param {object} manifest */
export function validateManifestVersion(manifest) {
  if (manifest.version !== SUPPORTED_MANIFEST_VERSION) {
    return {
      ok: false,
      errors: [
        `manifest version must be ${SUPPORTED_MANIFEST_VERSION}, got ${manifest.version ?? 'missing'}`,
      ],
    };
  }
  return { ok: true };
}

/**
 * @param {string} repoRoot
 * @param {object} manifest
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateProtectedPaths(repoRoot, manifest) {
  const errors = [];
  const testsRoot = resolve(repoRoot, 'tests') + sep;

  for (const relPath of Object.keys(manifest.protected_files ?? {})) {
    if (!relPath.startsWith('tests/') || relPath.includes('..')) {
      errors.push(`invalid protected path: ${relPath} (must be under tests/ without ..)`);
      continue;
    }
    const absPath = resolve(repoRoot, relPath);
    if (!absPath.startsWith(testsRoot)) {
      errors.push(`invalid protected path: ${relPath} (resolves outside tests/)`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * @param {string} repoRoot
 * @returns {{ ok: true, manifest: object } | { ok: false, errors: string[] }}
 */
export function loadManifestResult(repoRoot) {
  const manifestPath = join(repoRoot, MANIFEST_REL);
  const raw = readFileSync(manifestPath, 'utf8');
  const parsed = parseManifestJson(raw);
  if (!parsed.ok) return parsed;
  return { ok: true, manifest: parsed.manifest };
}

/** @param {string} repoRoot */
export function loadManifest(repoRoot) {
  const result = loadManifestResult(repoRoot);
  if (!result.ok) {
    throw new Error(result.errors.join('; '));
  }
  return result.manifest;
}

/**
 * @param {string} repoRoot
 * @param {string} ref
 * @param {(cwd: string, args: string[]) => string} runGit
 * @returns {{ ok: true, manifest: object } | { ok: false, errors: string[] }}
 */
export function loadManifestAtRefResult(repoRoot, ref, runGit = defaultRunGit) {
  try {
    const raw = runGit(repoRoot, ['show', `${ref}:${MANIFEST_REL}`]);
    return parseManifestJson(raw);
  } catch (err) {
    return {
      ok: false,
      errors: [`manifest load failed (${ref}): ${parseErrorMessage(err)}`],
    };
  }
}

/**
 * @param {string} repoRoot
 * @param {string} ref
 * @param {(cwd: string, args: string[]) => string} runGit
 */
export function loadManifestAtRef(repoRoot, ref, runGit = defaultRunGit) {
  const result = loadManifestAtRefResult(repoRoot, ref, runGit);
  if (!result.ok) {
    throw new Error(result.errors.join('; '));
  }
  return result.manifest;
}

/**
 * @param {Set<string>} requiredDescribes
 * @param {string} relPath
 * @param {Record<string, number>} baseFloors
 * @param {Record<string, number>} headFloors
 * @param {string} floorKind
 * @param {string[]} errors
 */
function checkFloorKeyRemoval(requiredDescribes, relPath, baseFloors, headFloors, floorKind, errors) {
  for (const [name, baseMin] of Object.entries(baseFloors)) {
    if (typeof baseMin !== 'number' || !Number.isFinite(baseMin)) continue;

    if (!(name in headFloors)) {
      if (requiredDescribes.has(name)) {
        errors.push(
          `manifest shrink: ${relPath} removed ${floorKind} for '${name}' while describe remains required`,
        );
      }
      continue;
    }

    const headMin = headFloors[name];
    if (typeof headMin !== 'number' || !Number.isFinite(headMin)) {
      errors.push(
        `manifest shrink: ${relPath} ${floorKind} for '${name}' must remain a number (was ${baseMin}, got ${headMin === null ? 'null' : typeof headMin})`,
      );
      continue;
    }
    if (headMin < baseMin) {
      errors.push(
        `manifest shrink: ${relPath} lowered ${floorKind} for '${name}' (${baseMin} -> ${headMin})`,
      );
    }
  }
}

/**
 * @param {Record<string, unknown>} baseObj
 * @param {Record<string, unknown>} headObj
 * @param {string} key
 * @param {string} label
 * @param {string[]} errors
 */
function checkNumericFieldShrink(baseObj, headObj, key, label, errors) {
  const baseVal = baseObj[key];
  if (typeof baseVal !== 'number' || !Number.isFinite(baseVal)) return;
  if (!(key in headObj)) {
    errors.push(`manifest shrink: removed ${label} (was ${baseVal})`);
    return;
  }
  const headVal = headObj[key];
  if (typeof headVal !== 'number' || !Number.isFinite(headVal)) {
    errors.push(
      `manifest shrink: ${label} must remain a number (was ${baseVal}, got ${headVal === null ? 'null' : typeof headVal})`,
    );
    return;
  }
  if (headVal < baseVal) {
    errors.push(`manifest shrink: lowered ${label} (${baseVal} -> ${headVal})`);
  }
}

/**
 * @param {Record<string, unknown>} basePolicy
 * @returns {{ ok: true, churnThreshold: number, minRemoved: number } | { ok: false, errors: string[] }}
 */
export function resolveDiffPolicyForDiff(basePolicy) {
  const policy =
    basePolicy != null && typeof basePolicy === 'object' && !Array.isArray(basePolicy)
      ? basePolicy
      : {};
  const errors = [];
  const DEFAULT_CHURN = 40;
  const DEFAULT_MIN_REMOVED = 20;

  /**
   * @param {string} key
   * @param {number} defaultVal
   * @param {string} label
   */
  function resolve(key, defaultVal, label) {
    if (!(key in policy)) return defaultVal;
    const val = policy[key];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      errors.push(
        `manifest policy: ${label} must be a finite number (got ${val === null ? 'null' : typeof val})`,
      );
      return defaultVal;
    }
    return val;
  }

  const churnThreshold = resolve('churn_threshold', DEFAULT_CHURN, 'diff_policy.churn_threshold');
  const minRemoved = resolve(
    'min_removed_without_manifest',
    DEFAULT_MIN_REMOVED,
    'diff_policy.min_removed_without_manifest',
  );
  return errors.length
    ? { ok: false, errors }
    : { ok: true, churnThreshold, minRemoved };
}

/**
 * @param {object} baseManifest
 * @param {object} headManifest
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function compareManifestShrink(baseManifest, headManifest) {
  const errors = [];
  const baseFiles = baseManifest.protected_files ?? {};
  const headFiles = headManifest.protected_files ?? {};

  const basePolicy = baseManifest.diff_policy ?? {};
  const headPolicy = headManifest.diff_policy ?? {};

  checkNumericFieldShrink(
    basePolicy,
    headPolicy,
    'churn_threshold',
    'diff_policy.churn_threshold',
    errors,
  );
  checkNumericFieldShrink(
    basePolicy,
    headPolicy,
    'min_removed_without_manifest',
    'diff_policy.min_removed_without_manifest',
    errors,
  );

  for (const relPath of Object.keys(baseFiles)) {
    if (!(relPath in headFiles)) {
      errors.push(`manifest shrink: removed protected file ${relPath}`);
    }
  }

  for (const [relPath, baseSpec] of Object.entries(baseFiles)) {
    const headSpec = headFiles[relPath];
    if (!headSpec) continue;

    const baseDescribes = new Set(baseSpec.required_describes ?? []);
    const headDescribes = new Set(headSpec.required_describes ?? []);
    for (const name of baseDescribes) {
      if (!headDescribes.has(name)) {
        errors.push(`manifest shrink: ${relPath} removed required describe '${name}'`);
      }
    }

    checkFloorKeyRemoval(
      baseDescribes,
      relPath,
      baseSpec.min_it_by_describe ?? {},
      headSpec.min_it_by_describe ?? {},
      'min_it',
      errors,
    );
    checkFloorKeyRemoval(
      baseDescribes,
      relPath,
      baseSpec.min_expect_by_describe ?? {},
      headSpec.min_expect_by_describe ?? {},
      'min_expect',
      errors,
    );

    checkNumericFieldShrink(baseSpec, headSpec, 'min_lines', `${relPath} min_lines`, errors);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * @param {string} repoRoot
 * @param {string} baseRef
 * @param {string} headRef
 * @param {(cwd: string, args: string[]) => string} runGit
 */
export function checkManifestShrink(repoRoot, baseRef, headRef, runGit = defaultRunGit) {
  const baseResult = loadManifestAtRefResult(repoRoot, baseRef, runGit);
  if (!baseResult.ok) return baseResult;
  const headResult = loadManifestAtRefResult(repoRoot, headRef, runGit);
  if (!headResult.ok) return headResult;
  return compareManifestShrink(baseResult.manifest, headResult.manifest);
}
