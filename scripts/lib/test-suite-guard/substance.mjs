import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extractTopLevelDescribes, extractDescribeBlocks } from './parser.mjs';
import { loadManifestResult, validateManifestVersion, validateProtectedPaths } from './manifest.mjs';

/**
 * @param {string} repoRoot
 * @param {object} manifest
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function checkManifest(repoRoot, manifest) {
  const errors = [];
  const versionResult = validateManifestVersion(manifest);
  if (!versionResult.ok) {
    errors.push(...versionResult.errors);
    return { ok: false, errors };
  }

  const pathResult = validateProtectedPaths(repoRoot, manifest);
  if (!pathResult.ok) errors.push(...pathResult.errors);

  for (const [relPath, spec] of Object.entries(manifest.protected_files ?? {})) {
    const absPath = resolve(repoRoot, relPath);
    if (!existsSync(absPath)) {
      errors.push(`missing protected test file: ${relPath}`);
      continue;
    }
    const source = readFileSync(absPath, 'utf8');
    const describes = extractTopLevelDescribes(source);
    for (const required of spec.required_describes ?? []) {
      if (!describes.includes(required)) {
        errors.push(`${relPath}: missing required describe('${required}')`);
      }
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * @param {string} repoRoot
 * @param {object} manifest
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function checkManifestSubstance(repoRoot, manifest) {
  const errors = [];
  const versionResult = validateManifestVersion(manifest);
  if (!versionResult.ok) {
    errors.push(...versionResult.errors);
    return { ok: false, errors };
  }

  const pathResult = validateProtectedPaths(repoRoot, manifest);
  if (!pathResult.ok) errors.push(...pathResult.errors);

  for (const [relPath, spec] of Object.entries(manifest.protected_files ?? {})) {
    const absPath = resolve(repoRoot, relPath);
    if (!existsSync(absPath)) continue;
    const source = readFileSync(absPath, 'utf8');
    const lineCount = source.split('\n').length;
    if (typeof spec.min_lines === 'number' && lineCount < spec.min_lines) {
      errors.push(`${relPath}: ${lineCount} lines below min_lines ${spec.min_lines}`);
    }

    const blocks = extractDescribeBlocks(source);
    const blockByName = new Map(blocks.map((block) => [block.name, block]));
    for (const [name, minIt] of Object.entries(spec.min_it_by_describe ?? {})) {
      const block = blockByName.get(name);
      if (!block) continue;
      if (block.itCount < minIt) {
        errors.push(
          `${relPath}: describe('${name}') has ${block.itCount} it() blocks, min_it ${minIt}`,
        );
      }
    }
    for (const [name, minExpect] of Object.entries(spec.min_expect_by_describe ?? {})) {
      const block = blockByName.get(name);
      if (!block) continue;
      if (block.expectCount < minExpect) {
        errors.push(
          `${relPath}: describe('${name}') has ${block.expectCount} expect() calls, min_expect ${minExpect}`,
        );
      }
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * @param {string} repoRoot
 * @param {object} [manifest]
 * @returns {{ ok: true, manifest: object } | { ok: false, errors: string[] }}
 */
export function resolveManifest(repoRoot, manifest) {
  if (manifest) return { ok: true, manifest };
  return loadManifestResult(repoRoot);
}
