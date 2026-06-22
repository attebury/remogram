import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer } from 'node:http';
import { runCli } from '@remogram/cli';
import { provider as giteaProvider } from '@remogram/provider-gitea-api';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { defaultTestConfig } from '../helpers/mock-provider.mjs';

describe('doctor --live', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
    delete process.env.GITEA_TOKEN;
    vi.unstubAllGlobals();
  });

  function startReachableRepoServer() {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        if (req.method === 'GET' && (req.url ?? '').includes('/repos/')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 1, name: 'repo' }));
          return;
        }
        res.writeHead(404).end('{}');
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('mock server failed to bind'));
          return;
        }
        resolve({
          baseUrl: `http://127.0.0.1:${address.port}`,
          close: () => new Promise((done, err) => server.close((e) => (e ? err(e) : done()))),
        });
      });
    });
  }

  it('default doctor does not fetch forge API', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    vi.stubGlobal('fetch', vi.fn());
    const { logs } = await captureCliOutput(() =>
      runCli(['doctor', '--json'], { cwd: setup.dir, providers: { 'gitea-api': giteaProvider } }),
    );
    expect(global.fetch).not.toHaveBeenCalled();
    const packet = JSON.parse(logs[0]);
    const reachability = packet.checks.find((check) => check.name === 'api_reachability');
    expect(reachability.status).toBe('skipped');
  });

  it('doctor --live reports repo_accessible on mock 200', async () => {
    const mock = await startReachableRepoServer();
    cleanups.push({ cleanup: mock.close });
    const setup = setupTempForge({
      config: {
        ...defaultTestConfig(),
        baseUrl: mock.baseUrl,
      },
      remoteUrl: `${mock.baseUrl}/owner/repo.git`,
    });
    cleanups.push(setup);
    process.env.GITEA_TOKEN = 'test-token';
    const { logs } = await captureCliOutput(() =>
      runCli(['doctor', '--live', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': giteaProvider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    const reachability = packet.checks.find((check) => check.name === 'api_reachability');
    expect(reachability.status).toBe('pass');
    expect(reachability.details.repo_accessible).toBe(true);
  });

  it('doctor --live maps unreachable forge host to failure_kind', async () => {
    const setup = setupTempForge({
      config: {
        ...defaultTestConfig(),
        baseUrl: 'http://127.0.0.1:1',
      },
      remoteUrl: 'http://127.0.0.1:1/owner/repo.git',
    });
    cleanups.push(setup);
    process.env.GITEA_TOKEN = 'test-token';
    const { logs } = await captureCliOutput(() =>
      runCli(['doctor', '--live', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': giteaProvider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    const reachability = packet.checks.find((check) => check.name === 'api_reachability');
    expect(reachability.status).toBe('fail');
    expect(reachability.details.failure_kind).toBe('network_unreachable');
  });
});
