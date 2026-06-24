import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractTopLevelDescribes,
  extractDescribeBlocks,
  checkManifest,
  checkManifestSubstance,
  checkDiff,
  compareManifestShrink,
  validateManifestVersion,
  validateProtectedPaths,
  loadManifest,
  parseManifestJson,
  runGuard,
} from '../../scripts/check-test-append-only.mjs';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '../../..');

const MANIFEST_V3 = {
  version: 3,
  diff_policy: {
    churn_threshold: 40,
    min_removed_without_manifest: 20,
  },
  protected_files: {
    'tests/core/path-allowlist.test.mjs': {
      required_describes: [
        'normalizeRepoRelativePath',
        'path allowlist',
        'normalizeChangedPathList',
      ],
      min_it_by_describe: {
        normalizeRepoRelativePath: 2,
        'path allowlist': 5,
        normalizeChangedPathList: 5,
      },
      min_expect_by_describe: {
        normalizeRepoRelativePath: 5,
        'path allowlist': 11,
        normalizeChangedPathList: 12,
      },
      min_lines: 75,
    },
  },
};

describe('test suite guard', () => {
  it('extractTopLevelDescribes finds top-level suites only', () => {
    const source = `
describe('normalizeRepoRelativePath', () => {
  it('nested', () => {});
});
describe('path allowlist', () => {
  describe('nested', () => {});
});
`;
    expect(extractTopLevelDescribes(source)).toEqual([
      'normalizeRepoRelativePath',
      'path allowlist',
    ]);
  });

  it('extractDescribeBlocks counts it() and test() per top-level suite', () => {
    const source = `
describe('normalizeRepoRelativePath', () => {
  it('a', () => {});
  test('b', () => {});
});
describe('path allowlist', () => {
  it('only', () => {});
});
`;
    expect(extractDescribeBlocks(source)).toEqual([
      { name: 'normalizeRepoRelativePath', itCount: 2, expectCount: 0 },
      { name: 'path allowlist', itCount: 1, expectCount: 0 },
    ]);
  });

  it('manifest v3 includes path-allowlist floors', () => {
    const manifest = loadManifest(REPO_ROOT);
    expect(manifest.version).toBe(3);
    expect(manifest.protected_files['tests/core/path-allowlist.test.mjs'].min_expect_by_describe).toEqual({
      normalizeRepoRelativePath: 5,
      'path allowlist': 11,
      normalizeChangedPathList: 12,
    });
  });

  it('runGuard passes with diff skipped for fast local check', () => {
    expect(runGuard({ repoRoot: REPO_ROOT, skipDiff: true }).ok).toBe(true);
  });

  it('checkManifest passes on current repository', () => {
    expect(checkManifest(REPO_ROOT, MANIFEST_V3).ok).toBe(true);
  });

  it('checkManifestSubstance passes on current repository', () => {
    expect(checkManifestSubstance(REPO_ROOT, MANIFEST_V3).ok).toBe(true);
  });

  it('checkManifest fails when a required describe is missing', () => {
    const manifest = loadManifest(REPO_ROOT);
    const result = checkManifest(REPO_ROOT, {
      ...manifest,
      protected_files: {
        'tests/core/path-allowlist.test.mjs': {
          ...manifest.protected_files['tests/core/path-allowlist.test.mjs'],
          required_describes: [
            ...manifest.protected_files['tests/core/path-allowlist.test.mjs'].required_describes,
            'nonexistent suite',
          ],
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("missing required describe('nonexistent suite')"))).toBe(
      true,
    );
  });

  it('checkManifestSubstance fails on hollow describe shells', () => {
    const hollowManifest = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/fixtures/test-suite-guard/hollow-fixture.mjs': {
          required_describes: ['empty suite'],
          min_it_by_describe: { 'empty suite': 1 },
          min_lines: 1,
        },
      },
    };
    const result = checkManifestSubstance(REPO_ROOT, hollowManifest);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('has 0 it() blocks'))).toBe(true);
  });

  it('checkManifestSubstance fails when file is below min_lines', () => {
    const manifest = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/fixtures/test-suite-guard/hollow-fixture.mjs': {
          required_describes: ['empty suite'],
          min_lines: 100,
        },
      },
    };
    const result = checkManifestSubstance(REPO_ROOT, manifest);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('below min_lines'))).toBe(true);
  });

  it('checkManifestSubstance fails on stub it() without expect() calls', () => {
    const stubManifest = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/fixtures/test-suite-guard/stub-it-fixture.mjs': {
          required_describes: ['stub suite'],
          min_it_by_describe: { 'stub suite': 5 },
          min_expect_by_describe: { 'stub suite': 1 },
          min_lines: 1,
        },
      },
    };
    const result = checkManifestSubstance(REPO_ROOT, stubManifest);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('min_expect'))).toBe(true);
  });

  it('validateManifestVersion rejects version 2', () => {
    expect(validateManifestVersion({ version: 2 }).ok).toBe(false);
  });

  it('validateProtectedPaths rejects path traversal keys', () => {
    const result = validateProtectedPaths(REPO_ROOT, {
      version: 3,
      protected_files: {
        '../outside.test.mjs': { required_describes: ['x'] },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('invalid protected path'))).toBe(true);
  });

  it('parseManifestJson returns error for invalid JSON', () => {
    const result = parseManifestJson('{not json');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('manifest parse failed'))).toBe(true);
  });

  it('checkDiff fails on net deletion without manifest change', () => {
    const runGit = (cwd, args) => {
      if (args[0] === 'diff' && args[1] === '--numstat') {
        return '10\t50\ttests/core/path-allowlist.test.mjs\n';
      }
      if (args[0] === 'diff' && args[1] === '--name-only') return '';
      if (args[0] === 'show') return JSON.stringify(MANIFEST_V3);
      throw new Error(`unexpected git: ${args.join(' ')}`);
    };
    const result = checkDiff(REPO_ROOT, 'base', 'head', MANIFEST_V3, runGit);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('net deletion'))).toBe(true);
  });

  it('checkDiff fails on balanced churn without manifest change', () => {
    const runGit = (cwd, args) => {
      if (args[0] === 'diff' && args[1] === '--numstat') {
        return '25\t25\ttests/core/path-allowlist.test.mjs\n';
      }
      if (args[0] === 'diff' && args[1] === '--name-only') return '';
      if (args[0] === 'show') return JSON.stringify(MANIFEST_V3);
      throw new Error(`unexpected git: ${args.join(' ')}`);
    };
    const result = checkDiff(REPO_ROOT, 'base', 'head', MANIFEST_V3, runGit);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('churn 50'))).toBe(true);
    expect(result.errors.some((e) => e.includes('25 lines removed'))).toBe(true);
  });

  it('compareManifestShrink fails when min_it is lowered', () => {
    const head = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/core/path-allowlist.test.mjs': {
          ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'],
          min_it_by_describe: {
            normalizeRepoRelativePath: 1,
            'path allowlist': 5,
            normalizeChangedPathList: 5,
          },
        },
      },
    };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('lowered min_it'))).toBe(true);
  });

  it('compareManifestShrink fails when min_it key removed but describe kept', () => {
    const head = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/core/path-allowlist.test.mjs': {
          ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'],
          min_it_by_describe: {
            normalizeRepoRelativePath: 2,
            normalizeChangedPathList: 5,
          },
        },
      },
    };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("removed min_it for 'path allowlist'"))).toBe(true);
  });

  it('compareManifestShrink fails when min_expect key removed but describe kept', () => {
    const head = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/core/path-allowlist.test.mjs': {
          ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'],
          min_expect_by_describe: {
            normalizeRepoRelativePath: 5,
            normalizeChangedPathList: 12,
          },
        },
      },
    };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("removed min_expect for 'path allowlist'"))).toBe(true);
  });

  it('compareManifestShrink fails when min_it is a string', () => {
    const head = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/core/path-allowlist.test.mjs': {
          ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'],
          min_it_by_describe: {
            ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'].min_it_by_describe,
            'path allowlist': '5',
          },
        },
      },
    };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('must remain a number') && e.includes('string'))).toBe(
      true,
    );
  });

  it('compareManifestShrink fails when min_expect is null', () => {
    const head = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/core/path-allowlist.test.mjs': {
          ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'],
          min_expect_by_describe: {
            ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'].min_expect_by_describe,
            'path allowlist': null,
          },
        },
      },
    };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('must remain a number') && e.includes('null'))).toBe(
      true,
    );
  });

  it('compareManifestShrink allows raising min_it floors', () => {
    const head = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/core/path-allowlist.test.mjs': {
          ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'],
          min_it_by_describe: {
            normalizeRepoRelativePath: 2,
            'path allowlist': 10,
            normalizeChangedPathList: 5,
          },
        },
      },
    };
    expect(compareManifestShrink(MANIFEST_V3, head).ok).toBe(true);
  });

  it('compareManifestShrink fails when diff_policy churn_threshold is null', () => {
    const head = {
      ...MANIFEST_V3,
      diff_policy: { churn_threshold: null, min_removed_without_manifest: 20 },
    };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('must remain a number') && e.includes('null'))).toBe(
      true,
    );
  });

  it('compareManifestShrink fails when diff_policy min_removed is null', () => {
    const head = {
      ...MANIFEST_V3,
      diff_policy: { churn_threshold: 40, min_removed_without_manifest: null },
    };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('must remain a number') && e.includes('null'))).toBe(
      true,
    );
  });

  it('compareManifestShrink fails when diff_policy churn_threshold is a string', () => {
    const head = {
      ...MANIFEST_V3,
      diff_policy: { churn_threshold: '40', min_removed_without_manifest: 20 },
    };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('must remain a number') && e.includes('string'))).toBe(
      true,
    );
  });

  it('compareManifestShrink fails when diff_policy churn_threshold is lowered', () => {
    const head = {
      ...MANIFEST_V3,
      diff_policy: { churn_threshold: 10, min_removed_without_manifest: 20 },
    };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('lowered diff_policy.churn_threshold'))).toBe(true);
  });

  it('compareManifestShrink fails when diff_policy churn_threshold key is removed', () => {
    const head = {
      ...MANIFEST_V3,
      diff_policy: { min_removed_without_manifest: 20 },
    };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('removed diff_policy.churn_threshold'))).toBe(true);
  });

  it('compareManifestShrink fails when diff_policy min_removed key is removed', () => {
    const head = {
      ...MANIFEST_V3,
      diff_policy: { churn_threshold: 40 },
    };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('removed diff_policy.min_removed_without_manifest'))).toBe(
      true,
    );
  });

  it('compareManifestShrink fails when entire diff_policy object is removed', () => {
    const head = { ...MANIFEST_V3, diff_policy: undefined };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('removed diff_policy.churn_threshold'))).toBe(true);
    expect(result.errors.some((e) => e.includes('removed diff_policy.min_removed_without_manifest'))).toBe(
      true,
    );
  });

  it('compareManifestShrink allows raising diff_policy thresholds', () => {
    const head = {
      ...MANIFEST_V3,
      diff_policy: { churn_threshold: 100, min_removed_without_manifest: 30 },
    };
    expect(compareManifestShrink(MANIFEST_V3, head).ok).toBe(true);
  });

  it('compareManifestShrink allows raising floors', () => {
    const head = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/core/path-allowlist.test.mjs': {
          ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'],
          min_lines: 80,
        },
      },
    };
    expect(compareManifestShrink(MANIFEST_V3, head).ok).toBe(true);
  });

  it('compareManifestShrink fails when min_lines is null', () => {
    const head = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/core/path-allowlist.test.mjs': {
          ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'],
          min_lines: null,
        },
      },
    };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('must remain a number') && e.includes('null') && e.includes('min_lines'))).toBe(
      true,
    );
  });

  it('compareManifestShrink fails when min_lines is a string', () => {
    const head = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/core/path-allowlist.test.mjs': {
          ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'],
          min_lines: '75',
        },
      },
    };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('must remain a number') && e.includes('string') && e.includes('min_lines'))).toBe(
      true,
    );
  });

  it('compareManifestShrink fails when min_lines key is removed', () => {
    const headSpec = { ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'] };
    delete headSpec.min_lines;
    const head = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/core/path-allowlist.test.mjs': headSpec,
      },
    };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('removed') && e.includes('min_lines'))).toBe(true);
  });

  it('compareManifestShrink fails when min_lines is lowered', () => {
    const head = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/core/path-allowlist.test.mjs': {
          ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'],
          min_lines: 50,
        },
      },
    };
    const result = compareManifestShrink(MANIFEST_V3, head);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('lowered') && e.includes('min_lines'))).toBe(true);
  });

  it('checkDiff fails closed when base diff_policy churn_threshold is null', () => {
    const baseManifest = {
      ...MANIFEST_V3,
      diff_policy: { churn_threshold: null, min_removed_without_manifest: 20 },
    };
    const runGit = (cwd, args) => {
      if (args[0] === 'diff' && args[1] === '--numstat') return '';
      if (args[0] === 'show' && args[1].startsWith('base:')) return JSON.stringify(baseManifest);
      throw new Error(`unexpected git: ${args.join(' ')}`);
    };
    const result = checkDiff(REPO_ROOT, 'base', 'head', MANIFEST_V3, runGit);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('must be a finite number') && e.includes('null'))).toBe(
      true,
    );
  });

  it('checkDiff fails closed when base diff_policy churn_threshold is a string', () => {
    const baseManifest = {
      ...MANIFEST_V3,
      diff_policy: { churn_threshold: '40', min_removed_without_manifest: 20 },
    };
    const runGit = (cwd, args) => {
      if (args[0] === 'diff' && args[1] === '--numstat') return '';
      if (args[0] === 'show' && args[1].startsWith('base:')) return JSON.stringify(baseManifest);
      throw new Error(`unexpected git: ${args.join(' ')}`);
    };
    const result = checkDiff(REPO_ROOT, 'base', 'head', MANIFEST_V3, runGit);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('must be a finite number') && e.includes('string'))).toBe(
      true,
    );
  });

  it('checkDiff uses default thresholds when base diff_policy is null', () => {
    const baseManifest = { ...MANIFEST_V3, diff_policy: null };
    const runGit = (cwd, args) => {
      if (args[0] === 'diff' && args[1] === '--numstat') return '';
      if (args[0] === 'show' && args[1].startsWith('base:')) return JSON.stringify(baseManifest);
      throw new Error(`unexpected git: ${args.join(' ')}`);
    };
    expect(checkDiff(REPO_ROOT, 'base', 'head', MANIFEST_V3, runGit).ok).toBe(true);
  });

  it('checkDiff fails closed when base diff_policy min_removed is null', () => {
    const baseManifest = {
      ...MANIFEST_V3,
      diff_policy: { churn_threshold: 40, min_removed_without_manifest: null },
    };
    const runGit = (cwd, args) => {
      if (args[0] === 'diff' && args[1] === '--numstat') return '';
      if (args[0] === 'show' && args[1].startsWith('base:')) return JSON.stringify(baseManifest);
      throw new Error(`unexpected git: ${args.join(' ')}`);
    };
    const result = checkDiff(REPO_ROOT, 'base', 'head', MANIFEST_V3, runGit);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('must be a finite number') && e.includes('null'))).toBe(
      true,
    );
  });

  it('checkDiff uses default thresholds when base diff_policy keys are absent', () => {
    const baseManifest = { ...MANIFEST_V3, diff_policy: {} };
    const runGit = (cwd, args) => {
      if (args[0] === 'diff' && args[1] === '--numstat') return '';
      if (args[0] === 'show' && args[1].startsWith('base:')) return JSON.stringify(baseManifest);
      throw new Error(`unexpected git: ${args.join(' ')}`);
    };
    expect(checkDiff(REPO_ROOT, 'base', 'head', MANIFEST_V3, runGit).ok).toBe(true);
  });

  it('checkDiff runs shrink check when diff_policy churn_threshold is nullified', () => {
    const baseManifestJson = JSON.stringify(MANIFEST_V3);
    const headManifest = {
      ...MANIFEST_V3,
      diff_policy: { churn_threshold: null, min_removed_without_manifest: 20 },
    };
    const runGit = (cwd, args) => {
      if (args[0] === 'diff' && args[1] === '--numstat') return '';
      if (args[0] === 'diff' && args[1] === '--name-only') {
        return 'tests/fixtures/test-suite-guard/manifest.json\n';
      }
      if (args[0] === 'show' && args[1].startsWith('base:')) return baseManifestJson;
      if (args[0] === 'show' && args[1].startsWith('head:')) return JSON.stringify(headManifest);
      throw new Error(`unexpected git: ${args.join(' ')}`);
    };
    const result = checkDiff(REPO_ROOT, 'base', 'head', MANIFEST_V3, runGit);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('must remain a number') && e.includes('null'))).toBe(
      true,
    );
  });

  it('checkDiff runs shrink check when manifest changed', () => {
    const baseManifestJson = JSON.stringify(MANIFEST_V3);
    const headManifest = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/core/path-allowlist.test.mjs': {
          ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'],
          min_it_by_describe: {
            normalizeRepoRelativePath: 1,
            'path allowlist': 5,
            normalizeChangedPathList: 5,
          },
        },
      },
    };
    const runGit = (cwd, args) => {
      if (args[0] === 'diff' && args[1] === '--numstat') return '';
      if (args[0] === 'diff' && args[1] === '--name-only') {
        return 'tests/fixtures/test-suite-guard/manifest.json\n';
      }
      if (args[0] === 'show' && args[1].startsWith('base:')) return baseManifestJson;
      if (args[0] === 'show' && args[1].startsWith('head:')) return JSON.stringify(headManifest);
      throw new Error(`unexpected git: ${args.join(' ')}`);
    };
    const result = checkDiff(REPO_ROOT, 'base', 'head', MANIFEST_V3, runGit);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('manifest shrink'))).toBe(true);
  });

  it('checkDiff still fails on high churn when manifest changed', () => {
    const baseManifestJson = JSON.stringify(MANIFEST_V3);
    const headManifest = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/core/path-allowlist.test.mjs': {
          ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'],
          min_lines: 80,
        },
      },
    };
    const runGit = (cwd, args) => {
      if (args[0] === 'diff' && args[1] === '--numstat') {
        return '25\t25\ttests/core/path-allowlist.test.mjs\n';
      }
      if (args[0] === 'diff' && args[1] === '--name-only') {
        return 'tests/fixtures/test-suite-guard/manifest.json\n';
      }
      if (args[0] === 'show' && args[1].startsWith('base:')) return baseManifestJson;
      if (args[0] === 'show' && args[1].startsWith('head:')) return JSON.stringify(headManifest);
      throw new Error(`unexpected git: ${args.join(' ')}`);
    };
    const result = checkDiff(REPO_ROOT, 'base', 'head', MANIFEST_V3, runGit);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('churn 50'))).toBe(true);
  });

  it('checkDiff passes when manifest changed with shrink ok and low churn', () => {
    const baseManifestJson = JSON.stringify(MANIFEST_V3);
    const headManifest = {
      ...MANIFEST_V3,
      protected_files: {
        'tests/core/path-allowlist.test.mjs': {
          ...MANIFEST_V3.protected_files['tests/core/path-allowlist.test.mjs'],
          min_lines: 80,
        },
      },
    };
    const runGit = (cwd, args) => {
      if (args[0] === 'diff' && args[1] === '--numstat') return '';
      if (args[0] === 'diff' && args[1] === '--name-only') {
        return 'tests/fixtures/test-suite-guard/manifest.json\n';
      }
      if (args[0] === 'show' && args[1].startsWith('base:')) return baseManifestJson;
      if (args[0] === 'show' && args[1].startsWith('head:')) return JSON.stringify(headManifest);
      throw new Error(`unexpected git: ${args.join(' ')}`);
    };
    expect(checkDiff(REPO_ROOT, 'base', 'head', MANIFEST_V3, runGit).ok).toBe(true);
  });
});
