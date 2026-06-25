import { describe, it, expect } from 'vitest';
import {
  resolveEffectiveWritePolicy,
  isWriteCommandAllowed,
  writeSourceForCommand,
  normalizeWritePolicyInput,
} from '@remogram/core';

describe('effective write policy', () => {
  it('unions repo and operator write commands with source attribution', () => {
    const policy = resolveEffectiveWritePolicy(
      { write_commands: ['cr_open'] },
      {
        config: { write_commands: ['merge'] },
        meta: { discovered_via: 'env', path: '~/operator.json', bind_ok: true },
        error: null,
      },
    );
    expect(policy.effectiveWriteCommands).toEqual(['cr_open', 'merge']);
    expect(policy.repoWriteCommands).toEqual(['cr_open']);
    expect(policy.operatorWriteCommands).toEqual(['merge']);
    expect(writeSourceForCommand(true, false)).toBe('repo');
    expect(writeSourceForCommand(false, true)).toBe('operator');
    expect(writeSourceForCommand(true, true)).toBe('both');
    expect(writeSourceForCommand(false, false)).toBe('none');
  });

  it('ignores operator grants when overlay load failed', () => {
    const policy = resolveEffectiveWritePolicy(
      { write_commands: [] },
      {
        config: null,
        meta: { discovered_via: 'cli_flag', bind_ok: false },
        error: { code: 'config_invalid', message: 'bind mismatch' },
      },
    );
    expect(policy.effectiveWriteCommands).toEqual([]);
    expect(policy.operatorWriteCommands).toEqual([]);
    expect(policy.operatorError?.code).toBe('config_invalid');
  });

  it('isWriteCommandAllowed checks effective union', () => {
    const policy = resolveEffectiveWritePolicy(
      { write_commands: ['status_set'] },
      {
        config: { write_commands: ['merge'] },
        meta: { discovered_via: 'env' },
        error: null,
      },
    );
    expect(isWriteCommandAllowed(policy, 'merge')).toBe(true);
    expect(isWriteCommandAllowed(policy, 'cr_open')).toBe(false);
  });

  it('normalizeWritePolicyInput accepts legacy repo config', () => {
    const policy = normalizeWritePolicyInput({ write_commands: ['issue_open'] });
    expect(policy.effectiveWriteCommands).toEqual(['issue_open']);
  });

  it('normalizeWritePolicyInput accepts ctx.writePolicy wrapper', () => {
    const inner = resolveEffectiveWritePolicy({ write_commands: ['merge'] }, { config: null, meta: {}, error: null });
    const policy = normalizeWritePolicyInput({ writePolicy: inner });
    expect(policy.effectiveWriteCommands).toEqual(['merge']);
  });
});
