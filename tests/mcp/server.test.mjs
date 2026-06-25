import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(__dirname, '../../packages/remogram-mcp/bin/remogram-mcp.js');

describe('remogram-mcp server', () => {
  it('lists forge tools on initialize', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      env: { ...process.env, REMOGRAM_CWD: process.cwd() },
    });
    const client = new Client({ name: 'remogram-test', version: '0.1.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'branch_protection',
      'command_contract_export',
      'cr_comments',
      'cr_files',
      'cr_inventory',
      'cr_open',
      'doctor',
      'forge_changes',
      'issue_bundle',
      'issue_comments',
      'issue_inventory',
      'issue_open',
      'issue_view',
      'merge_execute',
      'merge_plan',
      'pr_checks',
      'pr_status',
      'provider_capabilities',
      'ref_compare',
      'ref_inventory',
      'repo_status',
      'review_bundle',
      'status_set',
      'sync_plan',
      'verify_bind',
      'whoami',
    ]);
    await client.close();
  }, 15_000);
});
