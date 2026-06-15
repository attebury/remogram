import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKET_TYPES, SCHEMA_VERSION, MAX_OPEN_PULL_IDEMPOTENCY_PAGES, DEFAULT_OPEN_PULL_LIST_PAGE_SIZE } from '@remogram/core';
import { setupTempForge } from '../helpers/temp-forge.mjs';
import { withMcpClient, parseMcpPacket } from '../helpers/mcp-client.mjs';

function startMockGiteaApi() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      if (req.method === 'GET' && url.includes('/pulls')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
        return;
      }
      if (req.method === 'POST' && url.includes('/pulls')) {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            number: 55,
            html_url: 'http://127.0.0.1/owner/repo/pulls/55',
            title: 'MCP CR',
          }),
        );
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('mock Gitea server failed to bind'));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        close() {
          return new Promise((done, err) => server.close((e) => (e ? err(e) : done())));
        },
      });
    });
  });
}

function startMockGiteaTruncatedScanApi() {
  let listCalls = 0;
  let postCalls = 0;
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      if (req.method === 'GET' && url.includes('/pulls') && !/\/pulls\/\d+/.test(url)) {
        listCalls += 1;
        const items = Array.from({ length: DEFAULT_OPEN_PULL_LIST_PAGE_SIZE }, (_, i) => ({
          number: listCalls * 1000 + i,
          state: 'open',
          head: { ref: 'o' },
          base: { ref: 'r' },
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(items));
        return;
      }
      if (req.method === 'POST' && url.includes('/pulls')) {
        postCalls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'unexpected POST' }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('mock Gitea server failed to bind'));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        get listCalls() {
          return listCalls;
        },
        get postCalls() {
          return postCalls;
        },
        close() {
          return new Promise((done, err) => server.close((e) => (e ? err(e) : done())));
        },
      });
    });
  });
}

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

  it('returns the same tools as listTools', async () => {
    const setup = setupGithubForge();
    cleanups.push(setup);
    await withMcpClient(setup.dir, async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'cr_inventory',
        'cr_open',
        'doctor',
        'merge_plan',
        'pr_checks',
        'pr_status',
        'provider_capabilities',
        'ref_compare',
        'ref_inventory',
        'repo_status',
        'sync_plan',
      ]);
      const crOpen = tools.find((tool) => tool.name === 'cr_open');
      expect(crOpen?.annotations?.readOnlyHint).toBe(false);
      expect(crOpen?.annotations?.destructiveHint).toBe(true);
    });
  }, 15_000);

  it('cr_open returns change_request_opened via MCP with write_commands configured', async () => {
    const mockApi = await startMockGiteaApi();
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
        write_commands: ['cr_open'],
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.server.close() });
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'cr_open',
        arguments: { head: 'feat/x', base: 'remo', title: 'MCP CR' },
      });
      const packet = parseMcpPacket(result);
      expect(packet.type).toBe(PACKET_TYPES.CHANGE_REQUEST_OPENED);
      expect(packet.ok).toBe(true);
      expect(packet.pr_number).toBe(55);
    });
  }, 15_000);

  it('cr_open returns write_not_configured via MCP without write_commands', async () => {
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: 'http://localhost:3000',
      },
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'cr_open',
        arguments: { head: 'feat/x', base: 'remo', title: 'MCP CR' },
      });
      const packet = parseMcpPacket(result);
      expect(result.isError).toBe(true);
      expect(packet.type).toBe('forge_error');
      expect(packet.error_code).toBe('write_not_configured');
    });
  }, 15_000);

  it('cr_open returns idempotency_scan_incomplete via MCP when scan is truncated', async () => {
    const mockApi = await startMockGiteaTruncatedScanApi();
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
        write_commands: ['cr_open'],
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.server.close() });
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(
      setup.dir,
      async (client) => {
        const result = await client.callTool({
          name: 'cr_open',
          arguments: { head: 'feat/x', base: 'remo', title: 'MCP CR' },
        });
        const packet = parseMcpPacket(result);
        expect(result.isError).toBe(true);
        expect(packet.type).toBe('forge_error');
        expect(packet.error_code).toBe('idempotency_scan_incomplete');
        expect(packet.idempotency_scan).toEqual({
          pages: MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
          max_pages: MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
          page_size: DEFAULT_OPEN_PULL_LIST_PAGE_SIZE,
        });
        expect(mockApi.listCalls).toBe(MAX_OPEN_PULL_IDEMPOTENCY_PAGES);
        expect(mockApi.postCalls).toBe(0);
      },
      { REMOGRAM_FORGE_INGEST_MAX_BYTES: '65536' },
    );
  }, 30_000);

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
    await withMcpClient(setup.dir, async (client) => {
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
    });
  }, 15_000);

  it('ref_compare rejects invalid ref via MCP', async () => {
    const setup = setupGithubForge();
    cleanups.push(setup);
    await withMcpClient(
      setup.dir,
      async (client) => {
        const result = await client.callTool({
          name: 'ref_compare',
          arguments: { base: '--show-toplevel', head: 'main' },
        });
        expect(result.isError).toBe(true);
        const packet = parseMcpPacket(result);
        expect(packet.ok).toBe(false);
        expect(packet.error_code).toBe('invalid_args');
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

  it('pr_checks without auth returns forge_error via MCP', async () => {
    const setup = setupGithubForge();
    cleanups.push(setup);
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'pr_checks',
        arguments: { number: 1 },
      });
      expect(result.isError).toBe(true);
      const packet = parseMcpPacket(result);
      expect(packet.ok).toBe(false);
      expect(packet.type).toBe('forge_error');
    });
  }, 15_000);

  it('pr_checks rejects empty input at MCP schema', async () => {
    const setup = setupGithubForge();
    cleanups.push(setup);
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({ name: 'pr_checks', arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/--number or --ref required/i);
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

  it('cr_inventory without auth returns forge_error via MCP', async () => {
    const setup = setupGithubForge();
    cleanups.push(setup);
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({ name: 'cr_inventory', arguments: {} });
      expect(result.isError).toBe(true);
      const packet = parseMcpPacket(result);
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
