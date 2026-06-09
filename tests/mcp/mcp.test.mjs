import { describe, it, expect } from 'vitest';
import { runRemogramCli, packetToMcpContent, remogramCwd } from '../../packages/remogram-mcp/run-cli.mjs';

describe('remogram-mcp run-cli', () => {
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
    expect(out.content[0].type).toBe('text');
    expect(JSON.parse(out.content[0].text).type).toBe('repo_status');
  });

  it('packetToMcpContent marks parse failures as errors', () => {
    const out = packetToMcpContent('not json', 'fail', 1);
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content[0].text).error_code).toBe('unparseable_provider_output');
  });

  it('runRemogramCli is exported for integration', async () => {
    expect(typeof runRemogramCli).toBe('function');
  });
});
