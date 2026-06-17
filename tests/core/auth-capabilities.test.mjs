import { describe, it, expect } from 'vitest';
import { API_PROVIDER_COMMAND_AUTH, AUTH_CLASS, apiProviderCommands } from '@remogram/core';

const API_PROVIDER_MODULES = [
  ['gitea-api', () => import('@remogram/provider-gitea-api')],
  ['github-api', () => import('@remogram/provider-github-api')],
  ['gitlab-api', () => import('@remogram/provider-gitlab-api')],
];

describe('auth-aware provider capabilities', () => {
  it('apiProviderCommands lists auth_class for every command', () => {
    const commands = apiProviderCommands({
      writeCommandsImplemented: true,
      statusSetImplemented: true,
      branchProtectionImplemented: true,
      crFilesImplemented: true,
      crCommentsImplemented: true,
      forgeChangesImplemented: true,
    });
    expect(commands).toHaveLength(Object.keys(API_PROVIDER_COMMAND_AUTH).length);
    for (const command of commands) {
      expect(command.implemented).toBe(true);
      expect(command.auth_class).toBe(API_PROVIDER_COMMAND_AUTH[command.name]);
    }
    const readOnly = apiProviderCommands();
    expect(readOnly.find((c) => c.name === 'cr_open')?.implemented).toBe(false);
    expect(readOnly.find((c) => c.name === 'status_set')?.implemented).toBe(false);
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
      expect(byName.cr_open).toMatchObject({
        implemented: providerId === 'gitea-api',
        auth_class: AUTH_CLASS.TOKEN_REQUIRED,
      });
      expect(byName.status_set).toMatchObject({
        implemented:
          providerId === 'gitea-api'
          || providerId === 'github-api'
          || providerId === 'gitlab-api',
        auth_class: AUTH_CLASS.TOKEN_REQUIRED,
      });
      expect(byName.whoami).toMatchObject({
        implemented: true,
        auth_class: AUTH_CLASS.TOKEN_REQUIRED,
      });
      expect(byName.branch_protection).toMatchObject({
        implemented:
          providerId === 'gitea-api' ||
          providerId === 'github-api' ||
          providerId === 'gitlab-api',
        auth_class: AUTH_CLASS.TOKEN_REQUIRED,
      });
      expect(byName.cr_files).toMatchObject({
        implemented:
          providerId === 'gitea-api' ||
          providerId === 'github-api' ||
          providerId === 'gitlab-api',
        auth_class: AUTH_CLASS.TOKEN_REQUIRED,
      });
      expect(byName.cr_comments).toMatchObject({
        implemented:
          providerId === 'gitea-api' ||
          providerId === 'github-api' ||
          providerId === 'gitlab-api',
        auth_class: AUTH_CLASS.TOKEN_REQUIRED,
      });
      expect(byName.forge_changes).toMatchObject({
        implemented:
          providerId === 'gitea-api' ||
          providerId === 'github-api' ||
          providerId === 'gitlab-api',
        auth_class: AUTH_CLASS.TOKEN_REQUIRED,
      });
      if (providerId === 'gitea-api') {
        expect(body.idempotency_scan).toEqual({
          max_pages: 50,
          page_size: 100,
          ingest_backoff: 'halve_until_fit',
        });
      }
      if (providerId === 'github-api' || providerId === 'gitlab-api') {
        expect(body.idempotency_scan).toEqual({
          max_pages: 50,
          page_size: 25,
          ingest_backoff: 'halve_until_fit',
        });
      }
    });
  }
});
