import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverOperatorConfigPath,
  loadOperatorConfig,
  parseOperatorConfigFile,
  assertOperatorBindMatches,
  defaultOperatorConfigPath,
  REMOGRAM_OPERATOR_CONFIG_ENV,
  ERROR_CODES,
} from '@remogram/core';

const baseBind = {
  provider: 'gitea-api',
  remote: 'origin',
  owner: 'owner',
  repo: 'repo',
  baseUrl: 'http://localhost:3000',
};

const forgeCtx = {
  config: {
    provider: 'gitea-api',
    remote: 'origin',
    owner: 'owner',
    repo: 'repo',
    baseUrl: 'http://localhost:3000',
  },
  parsed: { owner: 'owner', repo: 'repo', host: 'localhost:3000' },
  baseUrl: 'http://localhost:3000',
};

describe('operator config', () => {
  /** @type {string[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) rmSync(cleanups.pop(), { recursive: true, force: true });
    delete process.env[REMOGRAM_OPERATOR_CONFIG_ENV];
  });

  function writeOperatorFile(dir, name, body) {
    const path = join(dir, name);
    writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
    chmodSync(path, 0o600);
    return path;
  }

  it('discovers cli flag before env and default path', () => {
    expect(
      discoverOperatorConfigPath({
        cliPath: '/tmp/cli.json',
        forgeContext: forgeCtx,
      }).discovered_via,
    ).toBe('cli_flag');
    process.env[REMOGRAM_OPERATOR_CONFIG_ENV] = '/tmp/env.json';
    expect(
      discoverOperatorConfigPath({
        cliPath: '/tmp/cli.json',
        forgeContext: forgeCtx,
      }).discovered_via,
    ).toBe('cli_flag');
    expect(discoverOperatorConfigPath({ forgeContext: forgeCtx }).discovered_via).toBe('env');
  });

  it('loads valid operator overlay with bind match', () => {
    const dir = mkdtempSync(join(tmpdir(), 'remogram-op-'));
    cleanups.push(dir);
    const path = writeOperatorFile(dir, 'operator.json', {
      version: '1',
      bind: baseBind,
      write_commands: ['merge'],
    });
    const loaded = loadOperatorConfig({ cliPath: path, forgeContext: forgeCtx });
    expect(loaded.error).toBeNull();
    expect(loaded.config.write_commands).toEqual(['merge']);
    expect(loaded.meta.bind_ok).toBe(true);
    expect(loaded.meta.discovered_via).toBe('cli_flag');
  });

  it('returns no overlay when file is missing', () => {
    const loaded = loadOperatorConfig({ cliPath: '/no/such/file.json', forgeContext: forgeCtx });
    expect(loaded.config).toBeNull();
    expect(loaded.error?.code).toBe(ERROR_CODES.CONFIG_INVALID);
  });

  it('rejects bind mismatch with structured fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'remogram-op-'));
    cleanups.push(dir);
    const path = writeOperatorFile(dir, 'operator.json', {
      version: '1',
      bind: { ...baseBind, remote: 'gitea' },
      write_commands: ['merge'],
    });
    const loaded = loadOperatorConfig({ cliPath: path, forgeContext: forgeCtx });
    expect(loaded.error?.code).toBe(ERROR_CODES.CONFIG_INVALID);
    expect(loaded.error?.fields?.field).toBe('remote');
    expect(loaded.error?.fields?.expected).toBe('origin');
    expect(loaded.error?.fields?.actual).toBe('gitea');
    expect(loaded.error?.fields?.remediation).toMatch(/REMOGRAM_OPERATOR_CONFIG|operator config/i);
  });

  it('rejects bind mismatch on owner/repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'remogram-op-'));
    cleanups.push(dir);
    const path = writeOperatorFile(dir, 'operator.json', {
      version: '1',
      bind: { ...baseBind, owner: 'wrong' },
      write_commands: ['merge'],
    });
    const loaded = loadOperatorConfig({ cliPath: path, forgeContext: forgeCtx });
    expect(loaded.config).toBeNull();
    expect(loaded.error?.code).toBe(ERROR_CODES.CONFIG_INVALID);
    expect(loaded.meta.bind_ok).toBe(false);
  });

  it('rejects forbidden credential keys', () => {
    expect(() =>
      parseOperatorConfigFile(
        JSON.stringify({
          version: '1',
          bind: baseBind,
          write_commands: ['merge'],
          token: 'secret',
        }),
      ),
    ).toThrow(/Forbidden key/);
  });

  it('rejects unknown write command ids', () => {
    expect(() =>
      parseOperatorConfigFile(
        JSON.stringify({
          version: '1',
          bind: baseBind,
          write_commands: ['merge_execute'],
        }),
      ),
    ).toThrow();
  });

  it('rejects world-writable operator file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'remogram-op-'));
    cleanups.push(dir);
    const path = join(dir, 'operator.json');
    writeFileSync(
      path,
      `${JSON.stringify({ version: '1', bind: baseBind, write_commands: ['merge'] })}\n`,
    );
    chmodSync(path, 0o666);
    const loaded = loadOperatorConfig({ cliPath: path, forgeContext: forgeCtx });
    expect(loaded.error?.message).toMatch(/world-writable/);
  });

  it('assertOperatorBindMatches accepts matching forge identity', () => {
    expect(() =>
      assertOperatorBindMatches(
        { bind: baseBind, write_commands: ['merge'], version: '1' },
        forgeCtx,
      ),
    ).not.toThrow();
  });

  it('defaultOperatorConfigPath uses provider-owner-repo filename', () => {
    const path = defaultOperatorConfigPath(forgeCtx);
    expect(path).toMatch(/remogram\/operator\/gitea-api-owner-repo\.json$/);
  });

  it('discovers xdg default path when file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'remogram-xdg-'));
    cleanups.push(dir);
    const operatorDir = join(dir, 'remogram', 'operator');
    mkdirSync(operatorDir, { recursive: true });
    const defaultPath = join(operatorDir, 'gitea-api-owner-repo.json');
    writeOperatorFile(operatorDir, 'gitea-api-owner-repo.json', {
      version: '1',
      bind: baseBind,
      write_commands: ['merge'],
    });
    const prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = dir;
    try {
      const discovery = discoverOperatorConfigPath({ forgeContext: forgeCtx });
      expect(discovery.discovered_via).toBe('xdg_default');
      expect(discovery.path).toBe(defaultPath);
    } finally {
      if (prev == null) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prev;
    }
  });
});
