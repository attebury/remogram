import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRefInventoryBody, loadConfig, ERROR_CODES } from '@remogram/core';
import { runCli } from '@remogram/cli';
import { provider as giteaProvider } from '@remogram/provider-gitea-api';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { defaultTestConfig } from '../helpers/mock-provider.mjs';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

describe('ref inventory', () => {
  /** @type {(() => void)[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  function repoWithBranches() {
    const config = defaultTestConfig();
    const setup = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    const defaultBranch = git(setup.dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    git(setup.dir, ['checkout', '-b', 'feature/wave2']);
    writeFileSync(join(setup.dir, 'feature.txt'), 'x\n');
    git(setup.dir, ['add', 'feature.txt']);
    git(setup.dir, ['commit', '-m', 'feature']);
    git(setup.dir, ['checkout', defaultBranch]);
    git(setup.dir, ['symbolic-ref', 'refs/remotes/origin/HEAD', `refs/heads/${defaultBranch}`]);
    cleanups.push(setup.cleanup);
    return setup;
  }

  it('buildRefInventoryBody lists local refs with shas', () => {
    const { dir } = repoWithBranches();
    const body = buildRefInventoryBody(dir, 'origin');
    expect(body.refs.length).toBeGreaterThanOrEqual(2);
    expect(body.refs.every((r) => r.name && r.sha && r.kind)).toBe(true);
    expect(body.refs.some((r) => r.name === 'main' || r.name === 'feature/wave2')).toBe(true);
  });

  it('cli refs inventory emits ref_inventory packet', async () => {
    const { dir } = repoWithBranches();
    const { logs } = await captureCliOutput(() =>
      runCli(['refs', 'inventory', '--json'], {
        cwd: dir,
        providers: { 'gitea-api': giteaProvider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe('ref_inventory');
    expect(packet.schema_version).toBe(1);
    expect(packet.ok).toBe(true);
    expect(Array.isArray(packet.refs)).toBe(true);
    expect(packet.refs.length).toBeGreaterThan(0);
    expect(packet).not.toHaveProperty('goal_branch');
    expect(packet).not.toHaveProperty('lane');
  });

  it('refs inventory respects git-root config binding from nested cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'ref-inv-root-'));
    const parent = mkdtempSync(join(tmpdir(), 'ref-inv-parent-'));
    cleanups.push(() => {
      rmSync(root, { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    });

    writeFileSync(
      join(root, '.remogram.json'),
      `${JSON.stringify(defaultTestConfig(), null, 2)}\n`,
    );
    git(root, ['init', '--template=']);
    git(root, ['config', 'user.email', 't@t.local']);
    git(root, ['config', 'user.name', 't']);
    writeFileSync(join(root, 'f'), 'x');
    git(root, ['add', 'f']);
    git(root, ['commit', '-m', 'init']);
    git(root, ['remote', 'add', 'origin', 'https://localhost:3000/o/r.git']);

    writeFileSync(
      join(parent, '.remogram.json'),
      `${JSON.stringify(defaultTestConfig({ owner: 'evil' }), null, 2)}\n`,
    );
    const nested = join(root, 'packages', 'nested');
    mkdirSync(nested, { recursive: true });

    expect(loadConfig(nested).path).toBe(join(root, '.remogram.json'));

    expect(() => loadConfig(join(parent, 'no-git'))).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({ code: ERROR_CODES.CONFIG_NOT_FOUND }),
      }),
    );
  });
});
