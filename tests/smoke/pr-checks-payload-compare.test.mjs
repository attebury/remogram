import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forgePacket, PACKET_TYPES, DEFAULT_MAX_BYTES } from '@remogram/core';
import { summarizeChecks as githubSummarize } from '@remogram/provider-github-api';
import { summarizeChecks as gitlabSummarize } from '@remogram/provider-gitlab-api';
import { byteSize, compareReport } from '../../scripts/lib/smoke-payload-metrics.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(__dirname, '../fixtures');

function loadFixture(provider, name) {
  return JSON.parse(readFileSync(join(fixturesRoot, provider, name), 'utf8'));
}

function packetCtx(providerId) {
  return { providerId, remoteName: 'origin', repoId: 'owner/repo' };
}

function mapGithubStatuses(raw) {
  return (raw || []).map((s) => ({
    context: s.context,
    state: s.state === 'success' ? 'success' : s.state,
    description: s.description,
  }));
}

function mapGithubCheckRuns(body) {
  return (body.check_runs || []).map((run) => ({
    context: run.name,
    state: 'success',
    description: run.output?.summary || run.status,
  }));
}

function assertPrChecksReport(report) {
  const serialized = JSON.stringify(report);
  expect(report.schema_version).toBe('1');
  expect(report.command).toBe('pr_checks');
  expect(report.remogram_ingest_cap_bytes).toBe(DEFAULT_MAX_BYTES);
  expect(report.remogram_packet.bytes).toBeGreaterThan(0);
  expect(serialized).not.toMatch(/"check_runs":\s*\[/);
}

describe('pr_checks payload compare fixtures', () => {
  it('github-api: statuses and check-runs baselines vs remogram packet', () => {
    const statuses = loadFixture('github-api', 'statuses-success.json');
    const checkRuns = loadFixture('github-api', 'check-runs-success.json');
    const mapped = [...mapGithubStatuses(statuses), ...mapGithubCheckRuns(checkRuns)];
    const body = {
      head_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      check_conclusion: githubSummarize(mapped),
      statuses: mapped,
    };
    const packet = forgePacket(PACKET_TYPES.PR_CHECKS, packetCtx('github-api'), body);
    const report = compareReport({
      command: 'pr_checks',
      providerId: 'github-api',
      prNumber: 42,
      remogramPacket: packet,
      baselines: {
        commit_statuses: { bytes: byteSize(statuses), label: 'github_commit_statuses' },
        check_runs: { bytes: byteSize(checkRuns), label: 'github_check_runs' },
      },
    });

    assertPrChecksReport(report);
    expect(report.baselines.commit_statuses.bytes).toBeLessThan(DEFAULT_MAX_BYTES);
    expect(report.ratios.vs_commit_statuses).toBeGreaterThan(0);
  });

  it('gitlab-api: statuses and pipelines baselines vs remogram packet', () => {
    const statuses = loadFixture('gitlab-api', 'statuses-success.json');
    const pipelines = loadFixture('gitlab-api', 'pipelines-success.json');
    const mappedStatuses = statuses.map((s) => ({
      context: s.name,
      state: 'success',
      description: s.description,
    }));
    const mappedPipelines = pipelines.map((p) => ({
      context: `pipeline:${p.id}`,
      state: 'success',
      description: p.status,
    }));
    const mapped = [...mappedStatuses, ...mappedPipelines];
    const body = {
      head_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      check_conclusion: gitlabSummarize(mapped),
      statuses: mapped,
    };
    const packet = forgePacket(PACKET_TYPES.PR_CHECKS, packetCtx('gitlab-api'), body);
    const report = compareReport({
      command: 'pr_checks',
      providerId: 'gitlab-api',
      prNumber: 42,
      remogramPacket: packet,
      baselines: {
        commit_statuses: { bytes: byteSize(statuses), label: 'gitlab_commit_statuses' },
        pipelines: { bytes: byteSize(pipelines), label: 'gitlab_pipelines' },
      },
    });

    assertPrChecksReport(report);
    expect(report.baselines.pipelines.bytes).toBeGreaterThan(0);
  });

  it('gitea-api: commit statuses baseline vs remogram packet', () => {
    const statuses = loadFixture('gitea-api', 'statuses-success.json');
    const mapped = statuses.map((s) => ({
      context: s.context,
      state: s.state,
      description: s.description,
    }));
    const body = {
      head_sha: 'bbb222',
      check_conclusion: 'success',
      statuses: mapped,
    };
    const packet = forgePacket(PACKET_TYPES.PR_CHECKS, packetCtx('gitea-api'), body);
    const report = compareReport({
      command: 'pr_checks',
      providerId: 'gitea-api',
      prNumber: 1,
      remogramPacket: packet,
      baselines: {
        commit_statuses: { bytes: byteSize(statuses), label: 'gitea_commit_statuses' },
      },
    });

    assertPrChecksReport(report);
  });
});
