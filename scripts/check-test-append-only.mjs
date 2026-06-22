#!/usr/bin/env node
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runGuard, defaultBaseRef } from './lib/test-suite-guard/run.mjs';

export { extractTopLevelDescribes, extractDescribeBlocks } from './lib/test-suite-guard/parser.mjs';
export {
  validateManifestVersion,
  validateProtectedPaths,
  loadManifest,
  loadManifestResult,
  loadManifestAtRef,
  compareManifestShrink,
  checkManifestShrink,
  defaultRunGit,
  parseManifestJson,
} from './lib/test-suite-guard/manifest.mjs';
export { checkManifest, checkManifestSubstance } from './lib/test-suite-guard/substance.mjs';
export { checkDiff } from './lib/test-suite-guard/diff.mjs';
export { runGuard, defaultBaseRef } from './lib/test-suite-guard/run.mjs';
export { MANIFEST_REL, SUPPORTED_MANIFEST_VERSION } from './lib/test-suite-guard/constants.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { base: null, head: 'HEAD', skipDiff: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base' && argv[i + 1]) {
      opts.base = argv[++i];
    } else if (argv[i] === '--head' && argv[i + 1]) {
      opts.head = argv[++i];
    } else if (argv[i] === '--skip-diff') {
      opts.skipDiff = true;
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = join(__dirname, '..');
  const result = runGuard({
    repoRoot,
    base: opts.base ?? defaultBaseRef(repoRoot),
    head: opts.head,
    skipDiff: opts.skipDiff,
  });

  if (result.ok) {
    console.log('test-suite-guard: ok');
    return;
  }

  console.error('test-suite-guard: failed');
  for (const err of result.errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
