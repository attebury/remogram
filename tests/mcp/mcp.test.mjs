import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveCliBin,
  runRemogramCli,
  packetToMcpContent,
  remogramCwd,
} from '../../packages/remogram-mcp/run-cli.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');

describe('remogram-mcp run-cli', () => {
  it('resolveCliBin finds @remogram/cli bin', () => {
    const bin = resolveCliBin();
    expect(existsSync(bin)).toBe(true);
    expect(bin).toMatch(/remogram\.js$/);
  });

  it('remogramCwd prefers REMOGRAM_CWD', () => {
    const prev = process.env.REMOGRAM_CWD;
    process.env.REMOGRAM_CWD = '/tmp/remogram-test-cwd';
    expect(remogramCwd()).toBe('/tmp/remogram-test-cwd');
    if (prev == null) delete process.env.REMOGRAM_CWD;
    else process.env.REMOGRAM_CWD = prev;
  });

  it('packetToMcpContent parses CLI JSON', () => {
    const out = packetToMcpContent(
      JSON.stringify({ type: 'repo_status', schema_version: 1, ok: true }),
      '',
      0,
    );
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.content[0].text).type).toBe('repo_status');
  });

  it('packetToMcpContent marks parse failures as errors', () => {
    const out = packetToMcpContent('not json', 'fail', 1);
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content[0].text).error_code).toBe('unparseable_provider_output');
  });

  it('runRemogramCli is exported for spawn delegation', () => {
    expect(typeof runRemogramCli).toBe('function');
  });

  it('runRemogramCli repo status with repo config', async () => {
    const prev = process.env.REMOGRAM_CWD;
    process.env.REMOGRAM_CWD = repoRoot;
    try {
      const result = await runRemogramCli(['repo', 'status']);
      expect(result.stdout).toContain('schema_version');
      const packet = JSON.parse(result.stdout);
      expect(packet.type).toBe('repo_status');
      // ok may be false without GITEA_TOKEN; envelope still valid
      expect(packet.provider_id).toBeTruthy();
    } finally {
      if (prev == null) delete process.env.REMOGRAM_CWD;
      else process.env.REMOGRAM_CWD = prev;
    }
  });
});

describe('project MCP config', () => {
  it('mcp.json.example matches expected remogram-mcp command', () => {
    const example = JSON.parse(
      readFileSync(join(repoRoot, '.cursor/mcp.json.example'), 'utf8'),
    );
    expect(example.mcpServers.remogram.command).toBe('remogram-mcp');
    expect(example.mcpServers.remogram.env.REMOGRAM_CWD).toBe('${workspaceFolder}');
  });
});
