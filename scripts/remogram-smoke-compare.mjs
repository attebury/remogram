#!/usr/bin/env node
/**
 * Opt-in pr_view payload size comparison via MCP pr_status + optional forge sidecar.
 * Writes sizes-only size_report.json; never logs raw forge JSON.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatCompareSummary } from './lib/smoke-payload-metrics.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const captureTools = join(__dirname, '../packages/remogram-mcp/capture-tools.mjs');

function parseArgs(argv) {
  const args = {
    prNumber: 1,
    forgeSidecar: false,
    outDir: null,
    sizesOnly: true,
  };

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
      const raw = argv[++i];
      args.prNumber = Number(raw);
      if (!Number.isInteger(args.prNumber) || args.prNumber < 1) {
        console.error('--pr-number must be a positive integer');
        process.exit(1);
      }
      continue;
    }
    if (arg === '--out') {
      args.outDir = argv[++i];
      if (!args.outDir) {
        console.error('--out requires a directory path');
        process.exit(1);
      }
      continue;
    }
    if (arg.startsWith('-')) {
      console.error(`unknown flag: ${arg}`);
      process.exit(1);
    }
    args.outDir = arg;
  }

  if (!args.outDir) {
    args.outDir = mkdtempSync(join(tmpdir(), 'remogram-smoke-'));
  }

  return args;
}

const args = parseArgs(process.argv);
const captureArgs = [
  captureTools,
  args.outDir,
  '--compare-pr-view',
  '--pr-number',
  String(args.prNumber),
];
if (args.forgeSidecar) captureArgs.push('--forge-sidecar');
if (args.sizesOnly) captureArgs.push('--sizes-only');

execFileSync(process.execPath, captureArgs, {
  stdio: 'inherit',
  env: { ...process.env, REMOGRAM_CWD: process.cwd() },
});

const report = JSON.parse(readFileSync(join(args.outDir, 'size_report.json'), 'utf8'));
console.log(formatCompareSummary(report));
console.log(`\nreport: ${join(args.outDir, 'size_report.json')}`);
