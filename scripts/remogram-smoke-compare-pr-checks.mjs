#!/usr/bin/env node
import { runSmokeCompare } from './remogram-smoke-compare-lib.mjs';

function parseArgs(argv) {
  const args = { prNumber: 1, forgeSidecar: false, outDir: null, sizesOnly: true };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--forge-sidecar') {
      args.forgeSidecar = true;
      continue;
    }
    if (arg === '--keep-packet') {
      args.sizesOnly = false;
      continue;
    }
    if (arg === '--pr-number') {
      args.prNumber = Number(argv[++i]);
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
  compareFlag: '--compare-pr-checks',
  extraArgs: ['--pr-number', String(args.prNumber)],
  forgeSidecar: args.forgeSidecar,
  outDir: args.outDir,
  sizesOnly: args.sizesOnly,
});
