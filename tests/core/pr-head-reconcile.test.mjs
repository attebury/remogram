import { describe, it, expect, afterEach } from 'vitest';
import {
  ERROR_CODES,
  PACKET_TYPES,
  localHeadShaForPr,
  staleHeadDetails,
} from '@remogram/core';
import { runCli } from '@remogram/cli';
import { setupTempForge, captureCliOutput } from '../helpers/temp-forge.mjs';
import { createMockProvider, defaultTestConfig } from '../helpers/mock-provider.mjs';
import { setupRepoWithRemoteBranch } from '../helpers/stale-head-repo.mjs';

describe('pr head reconciliation', () => {
  it('resolves local head via remote tracking ref', () => {
    const repo = setupRepoWithRemoteBranch();
    try {
      expect(localHeadShaForPr(repo.dir, 'origin', 'feat')).toBe(repo.localSha);
    } finally {
      repo.cleanup();
    }
  });

  it('detects stale forge head sha', () => {
    const repo = setupRepoWithRemoteBranch();
    try {
      const details = staleHeadDetails(
        repo.dir,
        'origin',
        'feat',
        'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      );
      expect(details).toEqual({
        head_ref: 'feat',
        head_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        local_head_sha: repo.localSha,
      });
    } finally {
      repo.cleanup();
    }
  });

  it('returns null when local and forge shas match', () => {
    const repo = setupRepoWithRemoteBranch();
    try {
      expect(staleHeadDetails(repo.dir, 'origin', 'feat', repo.localSha)).toBeNull();
    } finally {
      repo.cleanup();
    }
  });
});

describe('cli stale_head by PR number', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
    delete process.env.GITEA_TOKEN;
  });

  it('pr view emits stale_head when forge head diverges from local git', async () => {
    const repo = setupRepoWithRemoteBranch();
    cleanups.push({ cleanup: repo.cleanup });
    process.env.GITEA_TOKEN = 'test-token';
    const provider = createMockProvider({
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        url: 'http://localhost:3000/o/r/pulls/1',
        title: 'Test PR',
        state: 'open',
        base_ref: 'main',
        base_sha: 'aaa111',
        head_ref: 'feat',
        head_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        mergeability: 'clean',
      }),
    });
    const { logs } = await captureCliOutput(() =>
      runCli(['pr', 'view', '--number', '1', '--json'], {
        cwd: repo.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe(PACKET_TYPES.PR_STATUS);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe(ERROR_CODES.STALE_HEAD);
    expect(packet.head_ref).toBe('feat');
    expect(packet.local_head_sha).toBe(repo.localSha);
    expect(packet.head_sha).toBe('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  });

  it('pr checks emits stale_head when forge head diverges from local git', async () => {
    const repo = setupRepoWithRemoteBranch();
    cleanups.push({ cleanup: repo.cleanup });
    process.env.GITEA_TOKEN = 'test-token';
    const provider = createMockProvider({
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        url: 'http://localhost:3000/o/r/pulls/1',
        title: 'Test PR',
        state: 'open',
        base_ref: 'main',
        base_sha: 'aaa111',
        head_ref: 'feat',
        head_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        mergeability: 'clean',
      }),
      prChecks: async () => ({
        head_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        check_conclusion: 'success',
        statuses: [],
      }),
    });
    const { logs } = await captureCliOutput(() =>
      runCli(['pr', 'checks', '--number', '1', '--json'], {
        cwd: repo.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.type).toBe(PACKET_TYPES.PR_CHECKS);
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe(ERROR_CODES.STALE_HEAD);
    expect(packet.head_ref).toBe('feat');
    expect(packet.local_head_sha).toBe(repo.localSha);
  });

  it('pr checks by --ref skips stale_head reconciliation', async () => {
    const setup = setupTempForge({
      config: defaultTestConfig(),
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);
    process.env.GITEA_TOKEN = 'test-token';
    const provider = createMockProvider({
      prChecks: async (_ctx, { ref }) => ({
        head_sha: 'bbb222',
        check_conclusion: 'missing',
        statuses: [],
        ref,
      }),
    });
    const { logs } = await captureCliOutput(() =>
      runCli(['pr', 'checks', '--ref', 'HEAD', '--json'], {
        cwd: setup.dir,
        providers: { 'gitea-api': provider },
      }),
    );
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(true);
    expect(packet.error_code).toBeUndefined();
  });
});
