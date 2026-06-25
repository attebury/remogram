import { describe, it, expect } from 'vitest';
import { buildCommandContractBody, COMMAND_REGISTRY } from '@remogram/core';

describe('command contract export', () => {
  it('returns all command contracts when no command is provided', () => {
    const body = buildCommandContractBody();
    expect(Array.isArray(body.commands)).toBe(true);
    expect(body.commands.length).toBe(Object.keys(COMMAND_REGISTRY).length);
    expect(body.commands.length).toBe(25);
  });

  it('includes bundle commands in registry', () => {
    const commands = Object.keys(COMMAND_REGISTRY);
    expect(commands).toContain('verify bind');
    expect(commands).toContain('review bundle');
    expect(commands).toContain('issue bundle');
  });

  it('returns a single contract when command key exists', () => {
    const body = buildCommandContractBody('issue inventory');
    expect(body.found).toBe(true);
    expect(body.contract.command).toBe('issue inventory');
    expect(body.contract.mcp_tool).toBe('issue_inventory');
  });

  it('returns found=false for unknown command', () => {
    const body = buildCommandContractBody('not a command');
    expect(body.found).toBe(false);
    expect(body.contract).toBeUndefined();
  });
});
