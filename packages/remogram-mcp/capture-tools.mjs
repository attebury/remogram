#!/usr/bin/env node
/**
 * Invoke remogram-mcp tools and write JSON results for smoke comparison.
 * Usage: capture-tools.mjs <output-dir> [--remote <name>] [--compare-pr-view --pr-number N [--forge-sidecar] [--sizes-only]]
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { compareReport } from '../../scripts/lib/smoke-payload-metrics.mjs';
import {
  fetchSidecarPrViewBaselines,
  loadSmokeForgeContext,
} from '../../scripts/lib/forge-sidecar-pr-view.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(__dirname, 'bin/remogram-mcp.js');
const cwd = process.env.REMOGRAM_CWD || process.cwd();

function parseArgs(argv) {
  const args = {
    outDir: null,
    remote: null,
    comparePrView: false,
    prNumber: null,
    forgeSidecar: false,
    sizesOnly: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--compare-pr-view') {
      args.comparePrView = true;
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

const args = parseArgs(process.argv);

if (!args.outDir) {
  console.error(
    'usage: capture-tools.mjs <output-dir> [--remote <name>] [--compare-pr-view --pr-number N [--forge-sidecar] [--sizes-only]]',
  );
  process.exit(1);
}

if (args.comparePrView && args.prNumber == null) {
  console.error('--compare-pr-view requires --pr-number');
  process.exit(1);
}

let remote = args.remote || 'origin';
if (!args.remote) {
  try {
    const config = JSON.parse(readFileSync(join(cwd, '.remogram.json'), 'utf8'));
    remote = config.remote || remote;
  } catch {
    // keep default
  }
}

const tools = args.comparePrView
  ? [{ file: 'pr_status.json', name: 'pr_status', arguments: { number: args.prNumber } }]
  : [
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

mkdirSync(args.outDir, { recursive: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: { ...process.env, REMOGRAM_CWD: cwd },
});
const client = new Client({ name: 'remogram-smoke', version: '0.1.0' });
await client.connect(transport);

let failed = 0;
let prStatusPacket = null;

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
      packet: args.sizesOnly && args.comparePrView ? undefined : packet,
    };
    if (tool.name === 'pr_status') {
      prStatusPacket = packet;
      if (args.sizesOnly && args.comparePrView) {
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
      packet: args.sizesOnly
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

if (args.comparePrView) {
  let baselines = {};
  if (args.forgeSidecar) {
    try {
      const forgeCtx = loadSmokeForgeContext(cwd);
      baselines = await fetchSidecarPrViewBaselines({
        config: forgeCtx.config,
        parsed: forgeCtx.parsed,
        providerId: forgeCtx.providerId,
        prNumber: args.prNumber,
      });
    } catch (err) {
      baselines = {
        provider_path: {
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  const providerId = (() => {
    try {
      return loadSmokeForgeContext(cwd).providerId;
    } catch {
      try {
        return JSON.parse(readFileSync(join(cwd, '.remogram.json'), 'utf8')).provider;
      } catch {
        return 'unknown';
      }
    }
  })();

  const sizeReport = compareReport({
    providerId,
    prNumber: args.prNumber,
    remogramPacket: prStatusPacket || { ok: false },
    baselines,
  });

  writeFileSync(join(args.outDir, 'size_report.json'), `${JSON.stringify(sizeReport, null, 2)}\n`);
  console.log('size_report.json written');
}

await client.close();
process.exit(failed > 0 ? 1 : 0);
