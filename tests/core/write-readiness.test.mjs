import { describe, it, expect } from 'vitest';
import { buildWriteReadiness, writeReadinessHasWarnings } from '@remogram/core';

function giteaCapabilities() {
  return {
    write_support: true,
    write_commands: ['cr_open', 'status_set', 'merge', 'issue_open'],
    commands: [
      { name: 'cr_open', implemented: true, auth_class: 'token_required' },
      { name: 'issue_open', implemented: true, auth_class: 'token_required' },
      { name: 'status_set', implemented: true, auth_class: 'token_required' },
      { name: 'merge_execute', implemented: true, auth_class: 'token_required' },
    ],
  };
}

describe('write readiness', () => {
  it('marks configured write commands ready when auth is present', () => {
    const body = buildWriteReadiness(
      { write_commands: ['cr_open'] },
      giteaCapabilities(),
      { authPresent: true },
    );
    const crOpen = body.commands.find((entry) => entry.id === 'cr_open');
    expect(crOpen).toMatchObject({
      provider_supported: true,
      configured: true,
      auth_present: true,
      ready: true,
    });
    expect(body.configured_write_commands).toEqual(['cr_open']);
  });

  it('warns when provider write is not configured', () => {
    const body = buildWriteReadiness({ write_commands: ['cr_open'] }, giteaCapabilities(), {
      authPresent: true,
    });
    const merge = body.commands.find((entry) => entry.id === 'merge');
    expect(merge).toMatchObject({
      provider_supported: true,
      configured: false,
      ready: false,
    });
    expect(merge.next_config_snippet).toContain('merge');
    expect(writeReadinessHasWarnings(body)).toBe(true);
  });

  it('marks token writes not ready without auth', () => {
    const body = buildWriteReadiness({ write_commands: ['cr_open', 'merge'] }, giteaCapabilities(), {
      authPresent: false,
    });
    expect(body.commands.every((entry) => entry.ready === false)).toBe(true);
    expect(writeReadinessHasWarnings(body)).toBe(true);
  });
});
