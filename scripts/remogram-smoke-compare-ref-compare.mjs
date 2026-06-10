#!/usr/bin/env node
import { runSmokeCompare } from './remogram-smoke-compare-lib.mjs';

function parseArgs(argv) {
  const args = { base: 'main', head: 'feature/smoke-1', outDir: null, sizesOnly: true };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--keep-packet') {
      args.sizesOnly = false;
      continue;
    }
    if (arg === '--base') {
      args.base = argv[++i];
      continue;
    }
    if (arg === '--head') {
      args.head = argv[++i];
      continue;
    }
    if (arg === '--out') {
      args.outDir = argv[++i];
      continue;
    }
    if (!arg.startsWith('-')) args.outDir = arg;
  }
  return args;
}

const args = parseArgs(process.argv);
runSmokeCompare({
  compareFlag: '--compare-ref-compare',
  extraArgs: ['--base', args.base, '--head', args.head],
  forgeSidecar: false,
  outDir: args.outDir,
  sizesOnly: args.sizesOnly,
});
