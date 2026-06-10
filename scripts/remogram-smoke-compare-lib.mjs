#!/usr/bin/env node
/**
 * Shared smoke compare orchestrator for capture-tools compare modes.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatCompareSummary } from './lib/smoke-payload-metrics.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const captureTools = join(__dirname, '../packages/remogram-mcp/capture-tools.mjs');

export function runSmokeCompare({ compareFlag, extraArgs = [], forgeSidecar = false, outDir, sizesOnly = true }) {
  const outputDir = outDir || mkdtempSync(join(tmpdir(), 'remogram-smoke-'));
  const captureArgs = [captureTools, outputDir, compareFlag, ...extraArgs];
  if (forgeSidecar) captureArgs.push('--forge-sidecar');
  if (sizesOnly) captureArgs.push('--sizes-only');

  execFileSync(process.execPath, captureArgs, {
    stdio: 'inherit',
    env: { ...process.env, REMOGRAM_CWD: process.cwd() },
  });

  const report = JSON.parse(readFileSync(join(outputDir, 'size_report.json'), 'utf8'));
  console.log(formatCompareSummary(report));
  console.log(`\nreport: ${join(outputDir, 'size_report.json')}`);
}
