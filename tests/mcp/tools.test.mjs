import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKET_TYPES, SCHEMA_VERSION } from '@remogram/core';
import { setupTempForge } from '../helpers/temp-forge.mjs';
import { withMcpClient, parseMcpPacket } from '../helpers/mcp-client.mjs';

function git(dir, args) {
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
}

function setupGithubForge() {
  const setup = setupTempForge({
    config: {
      version: '1',
      provider: 'github-api',
      owner: 'owner',
      repo: 'repo',
      remote: 'origin',
    },
    remoteUrl: 'https://github.com/owner/repo.git',
  });
  git(setup.dir, ['branch', '-M', 'main']);
  git(setup.dir, ['checkout', '-b', 'feature/smoke-1']);
  writeFileSync(join(setup.dir, 'smoke.txt'), 'branch\n');
  git(setup.dir, ['add', 'smoke.txt']);
  git(setup.dir, ['commit', '-m', 'feature branch']);
  git(setup.dir, ['checkout', 'main']);
  return setup;
}

describe('remogram-mcp callTool', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
    delete process.env.GITEA_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITLAB_TOKEN;
  });

  function expectEnvelope(packet) {
    expect(packet.schema_version).toBe(SCHEMA_VERSION);
    expect(packet.provider_id).toBe('github-api');
    expect(packet.remote_name).toBe('origin');
    expect(packet.repo_id).toBe('owner/repo');
    expect(packet.observed_at).toMatch(/^\d{4}-/);
    expect(typeof packet.ok).toBe('boolean');
  }

  it('returns the same read-only tools as listTools', async () => {
    const setup = setupGithubForge();
    cleanups.push(setup);
    await withMcpClient(setup.dir, async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'doctor',
        'merge_plan',
        'pr_checks',
        'pr_status',
        'provider_capabilities',
        'ref_compare',
        'repo_status',
        'sync_plan',
      ]);
    });
  }, 15_000);

  it('doctor returns provider_doctor packet via MCP', async () => {
    const setup = setupGithubForge();
    cleanups.push(setup);
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({ name: 'doctor', arguments: {} });
      const packet = parseMcpPacket(result);
      expectEnvelope(packet);
      expect(packet.type).toBe(PACKET_TYPES.PROVIDER_DOCTOR);
      expect(packet.ok).toBe(true);
    });
  }, 15_000);

  it('provider_capabilities returns capability packet via MCP', async () => {
    const setup = setupGithubForge();
    cleanups.push(setup);
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({ name: 'provider_capabilities', arguments: {} });
      const packet = parseMcpPacket(result);
      expectEnvelope(packet);
      expect(packet.type).toBe(PACKET_TYPES.PROVIDER_CAPABILITIES);
      expect(packet.ok).toBe(true);
      expect(packet.write_support).toBe(false);
    });
  }, 15_000);

  it('repo_status returns repo_status packet via MCP', async () => {
    const setup = setupGithubForge();
    cleanups.push(setup);
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({ name: 'repo_status', arguments: {} });
      expect(result.isError).toBe(false);
      const packet = parseMcpPacket(result);
      expectEnvelope(packet);
      expect(packet.type).toBe(PACKET_TYPES.REPO_STATUS);
      expect(packet.ok).toBe(true);
    });
  }, 15_000);

  it('ref_compare resolves refs through MCP', async () => {
    const setup = setupGithubForge();
    cleanups.push(setup);
    await withMcpClient(
      setup.dir,
      async (client) => {
        const result = await client.callTool({
          name: 'ref_compare',
          arguments: { base: 'main', head: 'feature/smoke-1' },
        });
        expect(result.isError).toBe(false);
        const packet = parseMcpPacket(result);
        expectEnvelope(packet);
        expect(packet.type).toBe(PACKET_TYPES.REF_COMPARE);
        expect(packet.base_ref).toBe('main');
        expect(packet.head_ref).toBe('feature/smoke-1');
        expect(packet.ahead_by).toBe(1);
        expect(packet.behind_by).toBe(0);
      },
      { GITHUB_TOKEN: 'test-token' },
    );
  }, 15_000);

  it('sync_plan returns sync_plan packet via MCP', async () => {
    const setup = setupGithubForge();
    cleanups.push(setup);
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'sync_plan',
        arguments: { remote: 'origin' },
      });
      expect(result.isError).toBe(false);
      const packet = parseMcpPacket(result);
      expectEnvelope(packet);
      expect(packet.type).toBe(PACKET_TYPES.SYNC_PLAN);
      expect(packet.remote).toBe('origin');
      expect(packet.blockers).toContain('missing_remote_ref');
    });
  }, 15_000);

  it('pr_status without auth returns forge_error with MCP isError', async () => {
    const setup = setupGithubForge();
    cleanups.push(setup);
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'pr_status',
        arguments: { number: 1 },
      });
      expect(result.isError).toBe(true);
      const packet = parseMcpPacket(result);
      expectEnvelope(packet);
      expect(packet.ok).toBe(false);
      expect(packet.type).toBe('forge_error');
    });
  }, 15_000);

  it('merge_plan without auth returns forge_error via MCP', async () => {
    const setup = setupGithubForge();
    cleanups.push(setup);
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'merge_plan',
        arguments: { number: 1 },
      });
      expect(result.isError).toBe(true);
      const packet = parseMcpPacket(result);
      expect(packet.ok).toBe(false);
      expect(packet.type).toBe('forge_error');
    });
  }, 15_000);
});
