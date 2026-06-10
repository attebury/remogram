#!/usr/bin/env node
/**
 * Invoke remogram-mcp tools and write JSON results for smoke comparison.
 * Usage: capture-tools.mjs <output-dir> [--remote <name>]
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(__dirname, 'bin/remogram-mcp.js');
const cwd = process.env.REMOGRAM_CWD || process.cwd();

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: capture-tools.mjs <output-dir> [--remote <name>]');
  process.exit(1);
}

let remote = 'origin';
const remoteIdx = process.argv.indexOf('--remote');
if (remoteIdx !== -1 && process.argv[remoteIdx + 1]) {
  remote = process.argv[remoteIdx + 1];
} else {
  try {
    const config = JSON.parse(readFileSync(join(cwd, '.remogram.json'), 'utf8'));
    remote = config.remote || remote;
  } catch {
    // keep default
  }
}

const tools = [
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

mkdirSync(outDir, { recursive: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: { ...process.env, REMOGRAM_CWD: cwd },
});
const client = new Client({ name: 'remogram-smoke', version: '0.1.0' });
await client.connect(transport);

let failed = 0;
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
      packet,
    };
  } catch (err) {
    exitCode = 1;
    record = {
      tool: tool.name,
      isError: true,
      packet: {
        ok: false,
        type: 'capture_error',
        error_message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  writeFileSync(join(outDir, tool.file), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`${tool.file} exit=${exitCode}`);
  if (exitCode !== 0) failed += 1;
}

await client.close();
process.exit(failed > 0 ? 1 : 0);
