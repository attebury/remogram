import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from '@remogram/cli';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { createMockProvider, defaultTestConfig } from '../helpers/mock-provider.mjs';
import { withMcpClient, parseMcpPacket } from '../helpers/mcp-client.mjs';

describe('base_url CLI and MCP parity', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
    delete process.env.GITEA_TOKEN;
  });

  function setupForge() {
    const config = defaultTestConfig();
    const forge = setupTempForge({
      config,
      remoteUrl: 'https://localhost:3000/owner/repo.git',
    });
    cleanups.push(forge);
    const providers = { 'gitea-api': createMockProvider() };
    return { forge, providers, expectedBaseUrl: 'http://localhost:3000' };
  }

  async function cliPacket(forge, providers, args) {
    const { logs } = await captureCliOutput(() =>
      runCli([...args, '--json'], { cwd: forge.dir, providers }),
    );
    return JSON.parse(logs[0]);
  }

  it('repo_status and doctor share base_url across CLI and MCP', async () => {
    const { forge, providers, expectedBaseUrl } = setupForge();

    const cliRepoStatus = await cliPacket(forge, providers, ['repo', 'status']);
    const cliDoctor = await cliPacket(forge, providers, ['doctor']);

    expect(cliRepoStatus.base_url).toBe(expectedBaseUrl);
    expect(cliDoctor.base_url).toBe(expectedBaseUrl);

    await withMcpClient(forge.dir, async (client) => {
      const repoResult = await client.callTool({ name: 'repo_status', arguments: {} });
      const repoPacket = parseMcpPacket(repoResult);
      expect(repoPacket.base_url).toBe(expectedBaseUrl);

      const doctorResult = await client.callTool({ name: 'doctor', arguments: {} });
      const doctorPacket = parseMcpPacket(doctorResult);
      expect(doctorPacket.base_url).toBe(expectedBaseUrl);
    });

    expect(cliRepoStatus.base_url).toBe(cliDoctor.base_url);
  }, 15_000);
});
