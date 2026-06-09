import { describe, it, expect } from 'vitest';
import { forgeErrorPacket, unknownForgeContext, ERROR_CODES, forgeError } from '@remogram/core';
import { packetToMcpContent } from '@remogram/mcp/run-cli';

describe('remogram-mcp run-cli', () => {
  it('packetToMcpContent parse failure includes full envelope', () => {
    const out = packetToMcpContent('not json', 'fail', 1, false);
    expect(out.isError).toBe(true);
    const packet = JSON.parse(out.content[0].text);
    expect(packet.type).toBe('forge_error');
    expect(packet.schema_version).toBe(1);
    expect(packet.provider_id).toBe('unknown');
    expect(packet.repo_id).toBe('unknown/unknown');
    expect(packet.observed_at).toBeTruthy();
  });

  it('packetToMcpContent marks truncation as oversize error', () => {
    const out = packetToMcpContent('{}', '', 0, true);
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content[0].text).error_code).toBe('oversized_raw_output');
  });

  it('forgeErrorPacket from core is MCP-compatible', () => {
    const packet = forgeErrorPacket(
      unknownForgeContext(),
      forgeError(ERROR_CODES.CONFIG_NOT_FOUND, 'missing'),
    );
    expect(packet.observed_at).toMatch(/^\d{4}-/);
  });
});
