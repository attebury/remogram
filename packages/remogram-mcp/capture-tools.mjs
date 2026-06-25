#!/usr/bin/env node
/**
 * Invoke remogram-mcp tools and write JSON results for smoke comparison.
 * Usage: capture-tools.mjs <output-dir> [options]
 * Compare modes (mutually exclusive):
 *   --compare-pr-view --pr-number N
 *   --compare-pr-checks --pr-number N
 *   --compare-ref-compare --base REF --head REF
 * Shared: [--forge-sidecar] [--sizes-only] [--remote NAME]
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { compareReport, localGitOnlyBaseline } from '../../scripts/lib/smoke-payload-metrics.mjs';
import {
  fetchSidecarPrViewBaselines,
  loadSmokeForgeContext,
} from '../../scripts/lib/forge-sidecar-pr-view.mjs';
import { fetchSidecarPrChecksBaselines } from '../../scripts/lib/forge-sidecar-pr-checks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(__dirname, 'bin/remogram-mcp.js');
const cwd = process.env.REMOGRAM_CWD || process.cwd();

function parseArgs(argv) {
  const args = {
    outDir: null,
    remote: null,
    compareMode: null,
    prNumber: null,
    baseRef: null,
    headRef: null,
    forgeSidecar: false,
    sizesOnly: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--compare-pr-view') {
      args.compareMode = 'pr_view';
      continue;
    }
    if (arg === '--compare-pr-checks') {
      args.compareMode = 'pr_checks';
      continue;
    }
    if (arg === '--compare-ref-compare') {
      args.compareMode = 'ref_compare';
      continue;
    }
    if (arg === '--forge-sidecar') {
      args.forgeSidecar = true;
      continue;
    }
    if (arg === '--sizes-only') {
      args.sizesOnly = true;
      continue;
    }
    if (arg === '--remote') {
      args.remote = argv[i + 1];
      if (!args.remote) {
        console.error('--remote requires a value');
        process.exit(1);
      }
      i += 1;
      continue;
    }
    if (arg === '--pr-number') {
      const raw = argv[i + 1];
      if (!raw) {
        console.error('--pr-number requires a value');
        process.exit(1);
      }
      args.prNumber = Number(raw);
      if (!Number.isInteger(args.prNumber) || args.prNumber < 1) {
        console.error('--pr-number must be a positive integer');
        process.exit(1);
      }
      i += 1;
      continue;
    }
    if (arg === '--base') {
      args.baseRef = argv[i + 1];
      if (!args.baseRef) {
        console.error('--base requires a value');
        process.exit(1);
      }
      i += 1;
      continue;
    }
    if (arg === '--head') {
      args.headRef = argv[i + 1];
      if (!args.headRef) {
        console.error('--head requires a value');
        process.exit(1);
      }
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      console.error(`unknown flag: ${arg}`);
      process.exit(1);
    }
    if (!args.outDir) {
      args.outDir = arg;
    } else {
      console.error(`unexpected argument: ${arg}`);
      process.exit(1);
    }
  }

  return args;
}

function resolveProviderId() {
  try {
    return loadSmokeForgeContext(cwd).providerId;
  } catch {
    try {
      return JSON.parse(readFileSync(join(cwd, '.remogram.json'), 'utf8')).provider;
    } catch {
      return 'unknown';
    }
  }
}

function validateCompareArgs(args) {
  if (!args.compareMode) return;

  if (args.compareMode === 'ref_compare') {
    if (!args.baseRef || !args.headRef) {
      console.error('--compare-ref-compare requires --base and --head');
      process.exit(1);
    }
    return;
  }

  if (args.prNumber == null) {
    console.error(`--compare-${args.compareMode === 'pr_view' ? 'pr-view' : 'pr-checks'} requires --pr-number`);
    process.exit(1);
  }
}

const args = parseArgs(process.argv);

if (!args.outDir) {
  console.error(
    'usage: capture-tools.mjs <output-dir> [--remote <name>] [--compare-pr-view|--compare-pr-checks|--compare-ref-compare] ...',
  );
  process.exit(1);
}

validateCompareArgs(args);

let remote = args.remote || 'origin';
if (!args.remote) {
  try {
    const config = JSON.parse(readFileSync(join(cwd, '.remogram.json'), 'utf8'));
    remote = config.remote || remote;
  } catch {
    // keep default
  }
}

function buildTools() {
  if (args.compareMode === 'pr_view') {
    return [{ file: 'pr_status.json', name: 'pr_status', arguments: { number: args.prNumber } }];
  }
  if (args.compareMode === 'pr_checks') {
    return [{ file: 'pr_checks.json', name: 'pr_checks', arguments: { number: args.prNumber } }];
  }
  if (args.compareMode === 'ref_compare') {
    return [{
      file: 'refs_compare.json',
      name: 'ref_compare',
      arguments: { base: args.baseRef, head: args.headRef },
    }];
  }
  return [
    { file: 'doctor.json', name: 'doctor', arguments: {} },
    { file: 'provider_capabilities.json', name: 'provider_capabilities', arguments: {} },
    { file: 'repo_status.json', name: 'repo_status', arguments: {} },
    {
      file: 'refs_compare.json',
      name: 'ref_compare',
      arguments: { base: 'main', head: 'feature/smoke-1' },
    },
    { file: 'pr_status.json', name: 'pr_status', arguments: { number: 1 } },
    { file: 'pr_checks.json', name: 'pr_checks', arguments: { number: 1 } },
    { file: 'merge_plan.json', name: 'merge_plan', arguments: { number: 1 } },
    { file: 'sync_plan.json', name: 'sync_plan', arguments: { remote } },
  ];
}

const tools = buildTools();

mkdirSync(args.outDir, { recursive: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: { ...process.env, REMOGRAM_CWD: cwd },
});
const client = new Client({ name: 'remogram-smoke', version: '0.1.0' });
await client.connect(transport);

let failed = 0;
let comparePacket = null;
let compareToolName = null;

for (const tool of tools) {
  let exitCode = 0;
  let record;
  try {
    const result = await client.callTool({ name: tool.name, arguments: tool.arguments });
    const packet = JSON.parse(result.content[0].text);
    if (result.isError || packet.ok === false) exitCode = 1;
    record = {
      tool: tool.name,
      isError: Boolean(result.isError),
      packet: args.sizesOnly && args.compareMode ? undefined : packet,
    };
    if (args.compareMode) {
      comparePacket = packet;
      compareToolName = tool.name;
      if (args.sizesOnly) {
        record = {
          tool: tool.name,
          isError: Boolean(result.isError),
          packet_bytes: Buffer.byteLength(JSON.stringify(packet), 'utf8'),
        };
      }
    }
  } catch (err) {
    exitCode = 1;
    record = {
      tool: tool.name,
      isError: true,
      packet: args.sizesOnly && args.compareMode
        ? undefined
        : {
            ok: false,
            type: 'capture_error',
            error_message: err instanceof Error ? err.message : String(err),
          },
    };
  }
  writeFileSync(join(args.outDir, tool.file), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`${tool.file} exit=${exitCode}`);
  if (exitCode !== 0) failed += 1;
}

if (args.compareMode) {
  const providerId = resolveProviderId();
  let baselines = {};

  if (args.compareMode === 'ref_compare') {
    baselines = localGitOnlyBaseline();
  } else if (args.forgeSidecar) {
    try {
      const forgeCtx = loadSmokeForgeContext(cwd);
      if (args.compareMode === 'pr_view') {
        baselines = await fetchSidecarPrViewBaselines({
          config: forgeCtx.config,
          parsed: forgeCtx.parsed,
          providerId: forgeCtx.providerId,
          prNumber: args.prNumber,
        });
      } else {
        baselines = await fetchSidecarPrChecksBaselines({
          config: forgeCtx.config,
          parsed: forgeCtx.parsed,
          providerId: forgeCtx.providerId,
          prNumber: args.prNumber,
        });
      }
    } catch (err) {
      baselines = {
        provider_path: {
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  const sizeReport = compareReport({
    command: args.compareMode,
    providerId,
    prNumber: args.prNumber,
    baseRef: args.baseRef,
    headRef: args.headRef,
    remogramPacket: comparePacket || { ok: false, type: compareToolName },
    baselines,
  });

  writeFileSync(join(args.outDir, 'size_report.json'), `${JSON.stringify(sizeReport, null, 2)}\n`);
  console.log('size_report.json written');
}

await client.close();
process.exit(failed > 0 ? 1 : 0);
