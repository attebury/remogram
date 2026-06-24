import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { forgeFactInventoryPacket, FACT_INVENTORY_PACKET_TYPES, DEFAULT_MAX_BYTES } from '@remogram/core';
import { setupTempForge } from '../helpers/temp-forge.mjs';
import {
  byteSize,
  compareReport,
  localGitOnlyBaseline,
} from '../../scripts/lib/smoke-payload-metrics.mjs';

function git(dir, args) {
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
}

describe('ref_inventory payload compare fixtures', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
  });

  it('records remogram ref_inventory packet size with local_git_only baseline', () => {
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'gitea-api',
        owner: 'owner',
        repo: 'repo',
        baseUrl: 'http://localhost:3000',
        remote: 'origin',
      },
      remoteUrl: 'http://localhost:3000/owner/repo.git',
    });
    cleanups.push(setup);

    git(setup.dir, ['checkout', '-b', 'feature/smoke-ref']);
    git(setup.dir, ['checkout', 'main']);

    const mainSha = execFileSync('git', ['rev-parse', 'main'], { cwd: setup.dir, encoding: 'utf8' }).trim();
    const body = {
      refs: [{ name: 'main', sha: mainSha, kind: 'branch', is_default: true }],
      default_ref: 'main',
    };

    const packet = forgeFactInventoryPacket(FACT_INVENTORY_PACKET_TYPES.REF_INVENTORY, {
      providerId: 'gitea-api',
      remoteName: 'origin',
      repoId: 'owner/repo',
    }, body);

    const report = compareReport({
      command: 'ref_inventory',
      providerId: 'gitea-api',
      remogramPacket: packet,
      baselines: localGitOnlyBaseline(),
    });

    expect(report.command).toBe('ref_inventory');
    expect(report.remogram_ingest_cap_bytes).toBe(DEFAULT_MAX_BYTES);
    expect(report.remogram_packet.bytes).toBe(byteSize(packet));
    expect(report.baselines.local_git_only.bytes).toBe(0);
  });
});
