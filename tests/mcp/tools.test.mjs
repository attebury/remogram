import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync, mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKET_TYPES, SCHEMA_VERSION, MAX_OPEN_PULL_IDEMPOTENCY_PAGES, DEFAULT_OPEN_PULL_LIST_PAGE_SIZE, DEFAULT_CHECK_STATUS_PAGE_SIZE, MAX_CHECK_STATUS_PAGES } from '@remogram/core';
import { setupTempForge } from '../helpers/temp-forge.mjs';
import { withMcpClient, parseMcpPacket } from '../helpers/mcp-client.mjs';

function startMockGiteaMergeExecuteApi({
  branchTip,
  branchStatus = 200,
  scenario = 'default',
  checksConclusion = 'success',
} = {}) {
  const MERGE_BASE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const MERGE_HEAD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const CHECKS_MISMATCH_SHA = 'cccccccccccccccccccccccccccccccccccccccc';
  const HEAD_REF = 'feat/x';
  const MERGE_COMMIT = 'dddddddddddddddddddddddddddddddddddddddd';
  const FORK_OWNER = 'forker';
  const FORK_REPO = 'fork';
  const statuses =
    checksConclusion === 'missing'
      ? []
      : checksConclusion === 'pending'
        ? [{ id: 1, context: 'ci/gate', status: 'pending', description: 'waiting' }]
        : [{ id: 1, context: 'ci/gate', status: 'success', description: 'ok' }];
  let pullCalls = 0;
  let lastMergePostBody = null;
  let lastBranchUrl = null;
  const branchUrls = [];

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve(text ? JSON.parse(text) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });
  }

  function buildPull() {
    if (scenario === 'missingHeadRef') {
      return {
        number: 1,
        state: 'open',
        mergeable: true,
        html_url: 'http://127.0.0.1/owner/repo/pulls/1',
        base: { ref: 'remo', sha: MERGE_BASE },
        head: { sha: MERGE_HEAD },
      };
    }
    if (scenario === 'invalidHeadRef') {
      return {
        number: 1,
        state: 'open',
        mergeable: true,
        html_url: 'http://127.0.0.1/owner/repo/pulls/1',
        base: { ref: 'remo', sha: MERGE_BASE },
        head: { ref: '../evil', sha: MERGE_HEAD },
      };
    }
    pullCalls += 1;
    const headSha =
      scenario === 'checksMismatch' && pullCalls === 2 ? CHECKS_MISMATCH_SHA : MERGE_HEAD;
    return {
      number: 1,
      state: 'open',
      mergeable: true,
      html_url: 'http://127.0.0.1/owner/repo/pulls/1',
      base: { ref: 'remo', sha: MERGE_BASE },
      head: {
        ref: HEAD_REF,
        sha: headSha,
        ...(scenario === 'fork'
          ? { repo: { name: FORK_REPO, owner: { login: FORK_OWNER } } }
          : {}),
      },
    };
  }

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      if (req.method === 'GET' && /\/pulls\/1(\?|$)/.test(url)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(buildPull()));
        return;
      }
      if (req.method === 'GET' && /\/commits\/[^/]+\/statuses/.test(url)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(statuses));
        return;
      }
      if (req.method === 'GET' && /\/branches\//.test(url)) {
        lastBranchUrl = url;
        branchUrls.push(url);
        if (scenario === 'fork' && !url.includes(`/repos/${FORK_OWNER}/${FORK_REPO}/branches/`) && !/\/repos\/owner\/repo\/branches\//.test(url)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Branch not found in configured repo' }));
          return;
        }
        if (branchStatus === 404) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Branch not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            name: HEAD_REF,
            commit: { id: branchTip ?? MERGE_HEAD },
          }),
        );
        return;
      }
      if (req.method === 'POST' && /\/pulls\/1\/merge/.test(url)) {
        readJsonBody(req)
          .then((body) => {
            lastMergePostBody = body;
            if (scenario === 'postHeadMismatch') {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ message: 'head out of date' }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ sha: MERGE_COMMIT }));
          })
          .catch(() => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end('{}');
          });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('mock Gitea merge execute server failed to bind'));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        mergeCommit: MERGE_COMMIT,
        get lastMergePostBody() {
          return lastMergePostBody;
        },
        get lastBranchUrl() {
          return lastBranchUrl;
        },
        get branchUrls() {
          return [...branchUrls];
        },
        close() {
          return new Promise((done, err) => server.close((e) => (e ? err(e) : done())));
        },
      });
    });
  });
}

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

function startMockGiteaIssueOpenApi() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      if (req.method === 'GET' && url.includes('/issues') && !/\/issues\/\d+/.test(url)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
        return;
      }
      if (req.method === 'POST' && url.includes('/issues')) {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            number: 514,
            html_url: 'http://127.0.0.1/owner/repo/issues/514',
            state: 'open',
            title: 'Dogfood bug',
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
        reject(new Error('mock Gitea issue server failed to bind'));
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

function startMockGiteaStatusSetApi() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      if (req.method === 'GET' && url.includes('/statuses')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
        return;
      }
      if (req.method === 'POST' && url.includes('/statuses/')) {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 9,
            context: 'verify/wave1',
            status: 'success',
            description: 'MCP status',
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

function startMockGiteaStatusSetTruncatedScanApi() {
  let listCalls = 0;
  let postCalls = 0;
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = req.url ?? '';
      if (req.method === 'GET' && url.includes('/statuses')) {
        listCalls += 1;
        const items = Array.from({ length: DEFAULT_OPEN_PULL_LIST_PAGE_SIZE }, (_, i) => ({
          id: listCalls * 1000 + i,
          context: `ci/scan-${listCalls}-${i}`,
          status: 'success',
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(items));
        return;
      }
      if (req.method === 'POST' && url.includes('/statuses/')) {
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
    delete process.env.REMOGRAM_OPERATOR_CONFIG;
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
        'branch_protection',
        'command_contract_export',
        'cr_comments',
        'cr_files',
        'cr_inventory',
        'cr_open',
        'doctor',
        'forge_changes',
        'issue_bundle',
        'issue_comments',
        'issue_inventory',
        'issue_open',
        'issue_view',
        'merge_execute',
        'merge_plan',
        'pr_checks',
        'pr_status',
        'provider_capabilities',
        'ref_compare',
        'ref_inventory',
        'repo_status',
        'review_bundle',
        'status_set',
        'sync_plan',
        'verify_bind',
        'whoami',
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

  it('P4: cr_open via MCP honors REMOGRAM_OPERATOR_CONFIG overlay', async () => {
    const mockApi = await startMockGiteaApi();
    const operatorDir = mkdtempSync(join(tmpdir(), 'remogram-mcp-op-'));
    const operatorPath = join(operatorDir, 'operator.json');
    writeFileSync(
      operatorPath,
      `${JSON.stringify(
        {
          version: '1',
          bind: {
            provider: 'gitea-api',
            remote: 'origin',
            owner: 'owner',
            repo: 'repo',
            baseUrl: mockApi.baseUrl,
          },
          write_commands: ['cr_open'],
        },
        null,
        2,
      )}\n`,
    );
    chmodSync(operatorPath, 0o600);
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.server.close() });
    cleanups.push({ cleanup: () => rmSync(operatorDir, { recursive: true, force: true }) });
    process.env.GITEA_TOKEN = 'test-token';
    process.env.REMOGRAM_OPERATOR_CONFIG = operatorPath;
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'cr_open',
        arguments: { head: 'feat/x', base: 'remo', title: 'MCP CR' },
      });
      const packet = parseMcpPacket(result);
      expect(packet.type).toBe(PACKET_TYPES.CHANGE_REQUEST_OPENED);
      expect(packet.ok).toBe(true);
    });
  }, 15_000);

  const MERGE_BASE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const MERGE_HEAD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  it('merge_execute returns write_not_configured via MCP without write_commands', async () => {
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
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'merge_execute',
        arguments: {
          number: 1,
          expected_base_sha: MERGE_BASE,
          expected_head_sha: MERGE_HEAD,
        },
      });
      const packet = parseMcpPacket(result);
      expect(result.isError).toBe(true);
      expect(packet.error_code).toBe('write_not_configured');
    });
  }, 15_000);

  it('merge_execute returns cr_merged via MCP with mock Gitea forge', async () => {
    const mockApi = await startMockGiteaMergeExecuteApi();
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
        write_commands: ['merge'],
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.close() });
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'merge_execute',
        arguments: {
          number: 1,
          expected_base_sha: MERGE_BASE,
          expected_head_sha: MERGE_HEAD,
          method: 'merge',
        },
      });
      const packet = parseMcpPacket(result);
      expect(result.isError).toBe(false);
      expect(packet.type).toBe(PACKET_TYPES.CR_MERGED);
      expect(packet.ok).toBe(true);
      expect(packet.before.forge_head_ref_sha).toBe(MERGE_HEAD);
      expect(packet.merge.commit_sha).toBe(mockApi.mergeCommit);
      expect(mockApi.lastMergePostBody).toEqual({
        Do: 'merge',
        head_commit_id: MERGE_HEAD,
      });
    });
  }, 15_000);

  it('merge_execute returns cr_merged via MCP when merge_policy allows pending checks', async () => {
    const mockApi = await startMockGiteaMergeExecuteApi({ checksConclusion: 'pending' });
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
        write_commands: ['merge'],
        merge_policy: {
          allow_missing_checks: true,
          allow_pending_checks: true,
        },
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.close() });
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'merge_execute',
        arguments: {
          number: 1,
          expected_base_sha: MERGE_BASE,
          expected_head_sha: MERGE_HEAD,
          method: 'merge',
        },
      });
      const packet = parseMcpPacket(result);
      expect(result.isError).toBe(false);
      expect(packet.type).toBe(PACKET_TYPES.CR_MERGED);
      expect(packet.ok).toBe(true);
      expect(packet.before.checks_conclusion).toBe('pending');
      expect(packet.before.merge_policy.allow_pending_checks).toBe(true);
    });
  }, 15_000);

  it('merge_execute reads fork head branch from head.repo via MCP', async () => {
    const mockApi = await startMockGiteaMergeExecuteApi({ scenario: 'fork' });
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
        write_commands: ['merge'],
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.close() });
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'merge_execute',
        arguments: {
          number: 1,
          expected_base_sha: MERGE_BASE,
          expected_head_sha: MERGE_HEAD,
          method: 'merge',
        },
      });
      const packet = parseMcpPacket(result);
      expect(result.isError).toBe(false);
      expect(packet.type).toBe(PACKET_TYPES.CR_MERGED);
      expect(packet.ok).toBe(true);
      const forkBranchReads = mockApi.branchUrls.filter((u) =>
        String(u).includes('/repos/forker/fork/branches/'),
      );
      expect(forkBranchReads.length).toBeGreaterThan(0);
      expect(forkBranchReads.some((u) => String(u).includes('feat'))).toBe(true);
    });
  }, 15_000);

  it('merge_execute returns head_ref_moved via MCP when branch tip differs', async () => {
    const movedSha = 'cccccccccccccccccccccccccccccccccccccccc';
    const mockApi = await startMockGiteaMergeExecuteApi({ branchTip: movedSha });
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
        write_commands: ['merge'],
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.close() });
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'merge_execute',
        arguments: {
          number: 1,
          expected_base_sha: MERGE_BASE,
          expected_head_sha: MERGE_HEAD,
        },
      });
      const packet = parseMcpPacket(result);
      expect(result.isError).toBe(true);
      expect(packet.type).toBe(PACKET_TYPES.CR_MERGE_BLOCKED);
      expect(packet.blockers).toContain('head_ref_moved');
      expect(packet.before.forge_head_ref_sha).toBe(movedSha);
    });
  }, 15_000);

  it('merge_execute returns head_ref_unreadable via MCP when branch is missing', async () => {
    const mockApi = await startMockGiteaMergeExecuteApi({ branchStatus: 404 });
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
        write_commands: ['merge'],
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.close() });
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'merge_execute',
        arguments: {
          number: 1,
          expected_base_sha: MERGE_BASE,
          expected_head_sha: MERGE_HEAD,
        },
      });
      const packet = parseMcpPacket(result);
      expect(result.isError).toBe(true);
      expect(packet.type).toBe(PACKET_TYPES.CR_MERGE_BLOCKED);
      expect(packet.blockers).toContain('head_ref_unreadable');
      expect(packet.before.forge_head_ref_sha).toBeNull();
    });
  }, 15_000);

  // head_ref_unverified requires a provider without branchHeadSha; MCP uses real gitea-api (always implements it).
  // CLI mock-provider test covers that blocker; MCP shares the same dispatch path.

  it('merge_execute returns checks_head_sha_mismatch via MCP when sequential pulls diverge', async () => {
    const mockApi = await startMockGiteaMergeExecuteApi({ scenario: 'checksMismatch' });
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
        write_commands: ['merge'],
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.close() });
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'merge_execute',
        arguments: {
          number: 1,
          expected_base_sha: MERGE_BASE,
          expected_head_sha: MERGE_HEAD,
        },
      });
      const packet = parseMcpPacket(result);
      expect(result.isError).toBe(true);
      expect(packet.type).toBe(PACKET_TYPES.CR_MERGE_BLOCKED);
      expect(packet.blockers).toContain('checks_head_sha_mismatch');
    });
  }, 15_000);

  it('merge_execute returns head_ref_missing via MCP when pull has no head ref', async () => {
    const mockApi = await startMockGiteaMergeExecuteApi({ scenario: 'missingHeadRef' });
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
        write_commands: ['merge'],
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.close() });
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'merge_execute',
        arguments: {
          number: 1,
          expected_base_sha: MERGE_BASE,
          expected_head_sha: MERGE_HEAD,
        },
      });
      const packet = parseMcpPacket(result);
      expect(result.isError).toBe(true);
      expect(packet.type).toBe(PACKET_TYPES.CR_MERGE_BLOCKED);
      expect(packet.blockers).toContain('head_ref_missing');
    });
  }, 15_000);

  it('merge_execute returns head_ref_invalid via MCP for invalid head ref', async () => {
    const mockApi = await startMockGiteaMergeExecuteApi({ scenario: 'invalidHeadRef' });
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
        write_commands: ['merge'],
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.close() });
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'merge_execute',
        arguments: {
          number: 1,
          expected_base_sha: MERGE_BASE,
          expected_head_sha: MERGE_HEAD,
        },
      });
      const packet = parseMcpPacket(result);
      expect(result.isError).toBe(true);
      expect(packet.type).toBe(PACKET_TYPES.CR_MERGE_BLOCKED);
      expect(packet.blockers).toContain('head_ref_invalid');
      expect(packet.error_code).toBe('invalid_args');
    });
  }, 15_000);

  it('merge_execute returns invalid_args via MCP for malformed expected head SHA', async () => {
    const mockApi = await startMockGiteaMergeExecuteApi();
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
        write_commands: ['merge'],
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.close() });
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'merge_execute',
        arguments: {
          number: 1,
          expected_base_sha: MERGE_BASE,
          expected_head_sha: 'short',
        },
      });
      const packet = parseMcpPacket(result);
      expect(result.isError).toBe(true);
      expect(packet.type).toBe('forge_error');
      expect(packet.error_code).toBe('invalid_args');
    });
  }, 15_000);

  it('merge_execute returns head_ref_moved via MCP when forge POST rejects head_commit_id pin', async () => {
    const mockApi = await startMockGiteaMergeExecuteApi({ scenario: 'postHeadMismatch' });
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
        write_commands: ['merge'],
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.close() });
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'merge_execute',
        arguments: {
          number: 1,
          expected_base_sha: MERGE_BASE,
          expected_head_sha: MERGE_HEAD,
        },
      });
      const packet = parseMcpPacket(result);
      expect(result.isError).toBe(true);
      expect(packet.type).toBe(PACKET_TYPES.CR_MERGE_BLOCKED);
      expect(packet.blockers).toContain('head_ref_moved');
      expect(packet.error_code).toBe('merge_blocked');
      expect(mockApi.lastMergePostBody).toEqual({
        Do: 'merge',
        head_commit_id: MERGE_HEAD,
      });
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

  it('issue_open returns issue_opened via MCP with write_commands configured', async () => {
    const mockApi = await startMockGiteaIssueOpenApi();
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
        write_commands: ['issue_open'],
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.server.close() });
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'issue_open',
        arguments: { title: 'Dogfood bug' },
      });
      const packet = parseMcpPacket(result);
      expect(packet.type).toBe('issue_opened');
      expect(packet.issue_number).toBe(514);
      expect(packet.created).toBe(true);
    });
  }, 30_000);

  it('status_set returns commit_status_set via MCP with write_commands configured', async () => {
    const mockApi = await startMockGiteaStatusSetApi();
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
        write_commands: ['status_set'],
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.server.close() });
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'status_set',
        arguments: {
          sha: 'cccccccccccccccccccccccccccccccccccccccc',
          context: 'verify/wave1',
          state: 'success',
          description: 'MCP status',
        },
      });
      const packet = parseMcpPacket(result);
      expect(packet.type).toBe(PACKET_TYPES.COMMIT_STATUS_SET);
      expect(packet.ok).toBe(true);
      expect(packet.context).toBe('verify/wave1');
    });
  }, 15_000);

  it('status_set returns write_not_configured via MCP without write_commands', async () => {
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
        name: 'status_set',
        arguments: {
          sha: 'cccccccccccccccccccccccccccccccccccccccc',
          context: 'verify/wave1',
          state: 'success',
        },
      });
      const packet = parseMcpPacket(result);
      expect(result.isError).toBe(true);
      expect(packet.type).toBe('forge_error');
      expect(packet.error_code).toBe('write_not_configured');
    });
  }, 15_000);

  it('status_set returns idempotency_scan_incomplete via MCP when scan is truncated', async () => {
    const mockApi = await startMockGiteaStatusSetTruncatedScanApi();
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        remote: 'origin',
        baseUrl: mockApi.baseUrl,
        write_commands: ['status_set'],
      },
      remoteUrl: `${mockApi.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    cleanups.push({ cleanup: () => mockApi.server.close() });
    process.env.GITEA_TOKEN = 'test-token';
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'status_set',
        arguments: {
          sha: 'cccccccccccccccccccccccccccccccccccccccc',
          context: 'verify/wave1',
          state: 'success',
        },
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
    });
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
      expect(packet.write_support).toBe(true);
      expect(packet.write_commands).toEqual(['status_set']);
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
      expect(packet.compare_base_ref).toBe('main');
      expect(packet.compare_head_ref).toBe('feature/smoke-1');
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

  it('merge_plan with allowed_paths without auth returns forge_error via MCP', async () => {
    const setup = setupGithubForge();
    cleanups.push(setup);
    await withMcpClient(setup.dir, async (client) => {
      const result = await client.callTool({
        name: 'merge_plan',
        arguments: { number: 1, allowed_paths: ['packages/**'] },
      });
      expect(result.isError).toBe(true);
      const packet = parseMcpPacket(result);
      expect(packet.ok).toBe(false);
      expect(packet.type).toBe('forge_error');
      expect(packet.error_code).toBe('unauthenticated_provider');
    });
  }, 15_000);
});

describe('merge_plan MCP allowed_paths transport', () => {
  it('omits allowed-path argv for whitespace-only MCP allowed_paths', async () => {
    const { mergePlanMcpCliArgs } = await import('../../packages/remogram-mcp/register-tools.mjs');
    expect(mergePlanMcpCliArgs({ number: 1, allowed_paths: ['   '] })).toEqual([
      'merge',
      'plan',
      '--number',
      '1',
    ]);
    expect(mergePlanMcpCliArgs({ number: 1, allowed_paths: [''] })).toEqual([
      'merge',
      'plan',
      '--number',
      '1',
    ]);
  });

  it('includes trimmed in-scope globs in argv', async () => {
    const { mergePlanMcpCliArgs } = await import('../../packages/remogram-mcp/register-tools.mjs');
    expect(mergePlanMcpCliArgs({ number: 1, allowed_paths: ['packages/**'] })).toEqual([
      'merge',
      'plan',
      '--number',
      '1',
      '--allowed-path',
      'packages/**',
    ]);
    expect(mergePlanMcpCliArgs({ number: 1, allowed_paths: ['  packages/**  '] })).toEqual([
      'merge',
      'plan',
      '--number',
      '1',
      '--allowed-path',
      'packages/**',
    ]);
  });

  it('filters ..-segment globs from argv', async () => {
    const { mergePlanMcpCliArgs } = await import('../../packages/remogram-mcp/register-tools.mjs');
    expect(mergePlanMcpCliArgs({ number: 1, allowed_paths: ['packages/../topo/**'] })).toEqual([
      'merge',
      'plan',
      '--number',
      '1',
    ]);
  });
});
