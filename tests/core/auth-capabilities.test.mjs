import { describe, it, expect } from 'vitest';
import { API_PROVIDER_COMMAND_AUTH, AUTH_CLASS, apiProviderCommands } from '@remogram/core';

const API_PROVIDER_MODULES = [
  ['gitea-api', () => import('@remogram/provider-gitea-api')],
  ['github-api', () => import('@remogram/provider-github-api')],
];

describe('auth-aware provider capabilities', () => {
  it('apiProviderCommands lists auth_class for every command', () => {
    const commands = apiProviderCommands();
    expect(commands).toHaveLength(Object.keys(API_PROVIDER_COMMAND_AUTH).length);
    for (const command of commands) {
      expect(command.implemented).toBe(true);
      expect(command.auth_class).toBe(API_PROVIDER_COMMAND_AUTH[command.name]);
    }
  });

  for (const [providerId, loadModule] of API_PROVIDER_MODULES) {
    it(`${providerId} capabilities auth_class matches runtime requirements`, async () => {
      const mod = await loadModule();
      const provider = mod.provider;
      expect(provider.id).toBe(providerId);

      const body = await provider.providerCapabilities();
      const byName = Object.fromEntries(body.commands.map((c) => [c.name, c]));

      expect(byName.repo_status).toMatchObject({
        implemented: true,
        auth_class: AUTH_CLASS.NONE,
      });
      expect(byName.ref_compare).toMatchObject({
        implemented: true,
        auth_class: AUTH_CLASS.GIT_ONLY,
      });
      expect(byName.ref_inventory).toMatchObject({
        implemented: true,
        auth_class: AUTH_CLASS.GIT_ONLY,
      });
      expect(byName.cr_inventory).toMatchObject({
        implemented: true,
        auth_class: AUTH_CLASS.TOKEN_REQUIRED,
      });
      expect(byName.sync_plan).toMatchObject({
        implemented: true,
        auth_class: AUTH_CLASS.GIT_ONLY,
      });
      for (const name of ['cr_inventory', 'pr_status', 'pr_checks', 'merge_plan']) {
        expect(byName[name]).toMatchObject({
          implemented: true,
          auth_class: AUTH_CLASS.TOKEN_REQUIRED,
        });
      }
    });
  }
});
