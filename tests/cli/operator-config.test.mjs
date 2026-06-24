import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '@remogram/cli';
import { PACKET_TYPES, ERROR_CODES } from '@remogram/core';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { createMockProvider, defaultTestConfig } from '../helpers/mock-provider.mjs';

const MERGE_BASE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const MERGE_HEAD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const operatorBind = {
  provider: 'gitea-api',
  remote: 'origin',
  owner: 'owner',
  repo: 'repo',
  baseUrl: 'http://localhost:3000',
};

describe('operator write overlay', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];
  /** @type {string[]} */
  const tempDirs = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
    while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
    delete process.env.REMOGRAM_OPERATOR_CONFIG;
    delete process.env.GITEA_TOKEN;
  });

  function writeOperatorOverlay(extra = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'remogram-op-cli-'));
    tempDirs.push(dir);
    const path = join(dir, 'operator.json');
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          version: '1',
          bind: operatorBind,
          write_commands: ['merge'],
          ...extra,
        },
        null,
        2,
      )}\n`,
    );
    chmodSync(path, 0o600);
    return path;
  }

  it('P1: operator overlay grants merge when repo omits write_commands', async () => {
    const config = defaultTestConfig();
    delete config.write_commands;
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const operatorPath = writeOperatorOverlay();
    const mergeCommit = 'dddddddddddddddddddddddddddddddddddddddd';
    const mock = createMockProvider({
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        base_sha: MERGE_BASE,
        head_sha: MERGE_HEAD,
        head_ref: 'feat/x',
        mergeability: 'clean',
      }),
      prChecks: async () => ({
        head_sha: MERGE_HEAD,
        check_conclusion: 'success',
        checks_truncated: false,
        statuses: [],
      }),
      branchHeadSha: async () => MERGE_HEAD,
      mergeExecute: async () => ({ commit_sha: mergeCommit, provider_status: 200 }),
    });
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--operator-config',
          operatorPath,
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': mock } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.error_code).not.toBe('write_not_configured');
    expect(packet.type).toBe(PACKET_TYPES.CR_MERGED);
    expect(packet.ok).toBe(true);
  });

  it('P2: repo-only write_commands behavior unchanged', async () => {
    const config = defaultTestConfig({ write_commands: ['cr_open'] });
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    process.env.GITEA_TOKEN = 'test-token';
    const { logs } = await captureCliOutput(() =>
      runCli(['doctor', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': createMockProvider() },
      }),
    );
    const packet = JSON.parse(logs[0]);
    const crOpen = packet.write_config.commands.find((entry) => entry.id === 'cr_open');
    expect(crOpen).toMatchObject({ source: 'repo', ready: true });
    const merge = packet.write_config.commands.find((entry) => entry.id === 'merge');
    expect(merge).toMatchObject({ source: 'none', ready: false });
  });

  it('doctor reports merge source operator when overlay grants merge', async () => {
    const config = defaultTestConfig();
    delete config.write_commands;
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const operatorPath = writeOperatorOverlay();
    const { logs } = await captureCliOutput(() =>
      runCli(['doctor', '--operator-config', operatorPath, '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': createMockProvider() },
      }),
    );
    const packet = JSON.parse(logs[0]);
    const merge = packet.write_config.commands.find((entry) => entry.id === 'merge');
    expect(merge).toMatchObject({
      operator_configured: true,
      source: 'operator',
    });
    expect(packet.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'operator_config', status: 'pass' }),
      ]),
    );
  });

  it('N1: no repo writes and no overlay returns write_not_configured', async () => {
    const config = defaultTestConfig();
    delete config.write_commands;
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': createMockProvider() } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.error_code).toBe(ERROR_CODES.WRITE_NOT_CONFIGURED);
  });

  it('N2: bind mismatch blocks writes with config_invalid', async () => {
    const config = defaultTestConfig();
    delete config.write_commands;
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const operatorPath = writeOperatorOverlay({
      bind: { ...operatorBind, owner: 'wrong' },
    });
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'merge',
          'execute',
          '--number',
          '1',
          '--expected-base-sha',
          MERGE_BASE,
          '--expected-head-sha',
          MERGE_HEAD,
          '--operator-config',
          operatorPath,
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': createMockProvider() } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.error_code).toBe(ERROR_CODES.CONFIG_INVALID);
  });

  it('X3: enabling merge in overlay does not enable cr_open', async () => {
    const config = defaultTestConfig();
    delete config.write_commands;
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    const operatorPath = writeOperatorOverlay();
    process.env.GITEA_TOKEN = 'test-token';
    const { logs } = await captureCliOutput(() =>
      runCli(
        [
          'cr',
          'open',
          '--head',
          'feat/x',
          '--base',
          'remo',
          '--title',
          'T',
          '--operator-config',
          operatorPath,
          '--json',
        ],
        { cwd: setup.dir, providers: { 'gitea-api': createMockProvider() } },
      ),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.error_code).toBe(ERROR_CODES.WRITE_NOT_CONFIGURED);
  });
});
