import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { forgePacket, PACKET_TYPES, DEFAULT_MAX_BYTES } from '@remogram/core';
import { setupTempForge } from '../helpers/temp-forge.mjs';
import {
  byteSize,
  compareReport,
  localGitOnlyBaseline,
} from '../../scripts/lib/smoke-payload-metrics.mjs';

function git(dir, args) {
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
}

describe('ref_compare payload compare fixtures', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
  });

  it('records remogram packet size with local_git_only baseline', () => {
    const setup = setupTempForge({
      config: {
        version: '1',
        provider: 'github-api',
        owner: 'owner',
        repo: 'repo',
        baseUrl: 'https://github.com',
        remote: 'origin',
      },
      remoteUrl: 'https://github.com/owner/repo.git',
    });
    cleanups.push(setup);

    git(setup.dir, ['branch', '-M', 'main']);
    git(setup.dir, ['checkout', '-b', 'feature/smoke-ref']);
    writeFileSync(join(setup.dir, 'branch.txt'), 'feature\n');
    git(setup.dir, ['add', 'branch.txt']);
    git(setup.dir, ['commit', '-m', 'feature commit']);
    git(setup.dir, ['checkout', 'main']);

    const baseSha = execFileSync('git', ['rev-parse', 'main'], { cwd: setup.dir, encoding: 'utf8' }).trim();
    const headSha = execFileSync('git', ['rev-parse', 'feature/smoke-ref'], {
      cwd: setup.dir,
      encoding: 'utf8',
    }).trim();

    const body = {
      base_ref: 'main',
      base_sha: baseSha,
      head_ref: 'feature/smoke-ref',
      head_sha: headSha,
      ahead_by: 1,
      behind_by: 0,
    };

    const packet = forgePacket(PACKET_TYPES.REF_COMPARE, {
      providerId: 'github-api',
      remoteName: 'origin',
      repoId: 'owner/repo',
    }, body);

    const report = compareReport({
      command: 'ref_compare',
      providerId: 'github-api',
      baseRef: body.base_ref,
      headRef: body.head_ref,
      remogramPacket: packet,
      baselines: localGitOnlyBaseline(),
    });

    const serialized = JSON.stringify(report);
    expect(report.command).toBe('ref_compare');
    expect(report.base_ref).toBe('main');
    expect(report.head_ref).toBe('feature/smoke-ref');
    expect(report.remogram_ingest_cap_bytes).toBe(DEFAULT_MAX_BYTES);
    expect(report.remogram_packet.bytes).toBe(byteSize(packet));
    expect(report.baselines.local_git_only.bytes).toBe(0);
    expect(report.baselines.local_git_only.note).toMatch(/local git/i);
    expect(serialized).not.toMatch(/ahead_by/);
    expect(report.ratios.vs_local_git_only).toBeUndefined();
  });
});
