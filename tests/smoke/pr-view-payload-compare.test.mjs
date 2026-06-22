import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forgePacket, PACKET_TYPES, DEFAULT_MAX_BYTES } from '@remogram/core';
import { mergeability as gitlabMergeability } from '@remogram/provider-gitlab-api';
import { graphqlPullToRestShape, mergeability as githubMergeability } from '@remogram/provider-github-api';
import { byteSize, compareReport } from '../../scripts/lib/smoke-payload-metrics.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(__dirname, '../fixtures');

function loadFixture(provider, name) {
  return JSON.parse(readFileSync(join(fixturesRoot, provider, name), 'utf8'));
}

function packetCtx(providerId) {
  return {
    providerId,
    remoteName: 'origin',
    repoId: 'owner/repo',
  };
}

function giteaMergeability(pr) {
  if (pr.mergeable === true) return 'clean';
  if (pr.mergeable === false) return 'conflicted';
  return 'unknown';
}

function giteaPrBody(pull) {
  return {
    pr_number: pull.number,
    url: pull.html_url ?? pull.url,
    title: String(pull.title).replace(/\r?\n/g, ' ').trim(),
    state: pull.state,
    forge_target_branch_ref: pull.base?.ref,
    forge_target_sha: pull.base?.sha,
    forge_source_branch_ref: pull.head?.ref,
    forge_source_sha: pull.head?.sha,
    mergeability: giteaMergeability(pull),
  };
}

function gitlabMrBody(mr) {
  return {
    pr_number: mr.iid,
    url: mr.web_url ?? mr.url,
    title: String(mr.title).replace(/\r?\n/g, ' ').trim(),
    state: mr.state === 'opened' ? 'open' : mr.state,
    forge_target_branch_ref: mr.target_branch,
    forge_target_sha: mr.diff_refs?.forge_target_sha,
    forge_source_branch_ref: mr.source_branch,
    forge_source_sha: mr.sha ?? mr.diff_refs?.forge_source_sha,
    mergeability: gitlabMergeability(mr),
  };
}

function githubPrBody(graphqlFixture) {
  const pr = graphqlPullToRestShape(graphqlFixture.data.repository.pullRequest);
  return {
    pr_number: pr.number,
    url: pr.html_url,
    title: String(pr.title).replace(/\r?\n/g, ' ').trim(),
    state: pr.state,
    forge_target_branch_ref: pr.base?.ref,
    forge_target_sha: pr.base?.sha,
    forge_source_branch_ref: pr.head?.ref,
    forge_source_sha: pr.head?.sha,
    mergeability: githubMergeability(pr),
  };
}

function assertSizesOnlyReport(report) {
  const serialized = JSON.stringify(report);
  expect(report.schema_version).toBe('1');
  expect(report.command).toBe('pr_view');
  expect(report.remogram_ingest_cap_bytes).toBe(DEFAULT_MAX_BYTES);
  expect(report.remogram_packet.bytes).toBeGreaterThan(0);
  expect(report.remogram_packet.token_estimate).toBe(Math.ceil(report.remogram_packet.bytes / 4));
  expect(serialized).not.toMatch(/"title":/);
  expect(serialized).not.toMatch(/pullRequest/);
}

describe('pr-view payload compare fixtures', () => {
  it('github-api: bloated REST exceeds ingest cap; GraphQL baseline and packet stay bounded', () => {
    const graphql = loadFixture('github-api', 'pull-graphql-clean.json');
    const restMinimal = loadFixture('github-api', 'pull-clean.json');
    const restBloated = { ...restMinimal, body: 'x'.repeat(9000) };

    expect(byteSize(restBloated)).toBeGreaterThan(DEFAULT_MAX_BYTES);
    expect(byteSize(graphql)).toBeLessThan(DEFAULT_MAX_BYTES);

    const body = githubPrBody(graphql);
    const packet = forgePacket(PACKET_TYPES.PR_STATUS, packetCtx('github-api'), body);
    const report = compareReport({
      command: 'pr_view',
      providerId: 'github-api',
      prNumber: body.pr_number,
      remogramPacket: packet,
      baselines: {
        provider_path: { bytes: byteSize(graphql), label: 'github_graphql_response' },
        github_rest_pull: { bytes: byteSize(restBloated) },
      },
    });

    assertSizesOnlyReport(report);
    expect(report.baselines.provider_path.bytes).toBeLessThan(DEFAULT_MAX_BYTES);
    expect(report.baselines.github_rest_pull.exceeds_ingest_cap).toBe(true);
    expect(report.ratios.vs_github_rest_pull).toBeLessThan(1);
  });

  it('gitea-api: provider fixture baseline vs remogram packet', () => {
    const pull = loadFixture('gitea-api', 'pull.json');
    const body = giteaPrBody(pull);
    const packet = forgePacket(PACKET_TYPES.PR_STATUS, packetCtx('gitea-api'), body);
    const report = compareReport({
      command: 'pr_view',
      providerId: 'gitea-api',
      prNumber: body.pr_number,
      remogramPacket: packet,
      baselines: {
        provider_path: { bytes: byteSize(pull), label: 'gitea_rest_pull' },
      },
    });

    assertSizesOnlyReport(report);
    expect(report.baselines.provider_path.bytes).toBeGreaterThan(0);
    expect(report.ratios.vs_provider_path).toBeGreaterThan(0);
  });

  it('gitlab-api: merge request fixture baseline vs remogram packet', () => {
    const mr = loadFixture('gitlab-api', 'merge-request-clean.json');
    const body = gitlabMrBody(mr);
    const packet = forgePacket(PACKET_TYPES.PR_STATUS, packetCtx('gitlab-api'), body);
    const report = compareReport({
      command: 'pr_view',
      providerId: 'gitlab-api',
      prNumber: body.pr_number,
      remogramPacket: packet,
      baselines: {
        provider_path: { bytes: byteSize(mr), label: 'gitlab_merge_request' },
      },
    });

    assertSizesOnlyReport(report);
    expect(report.baselines.provider_path.bytes).toBeLessThan(DEFAULT_MAX_BYTES);
  });

  it('records sidecar skip errors without forge bodies', () => {
    const packet = forgePacket(PACKET_TYPES.PR_STATUS, packetCtx('github-api'), {
      pr_number: 1,
      url: 'https://github.com/o/r/pull/1',
      title: 't',
      state: 'open',
      forge_target_branch_ref: 'main',
      forge_target_sha: 'a'.repeat(40),
      forge_source_branch_ref: 'feat',
      forge_source_sha: 'b'.repeat(40),
      mergeability: 'clean',
    });
    const report = compareReport({
      command: 'pr_view',
      providerId: 'github-api',
      prNumber: 1,
      remogramPacket: packet,
      baselines: {
        provider_path: { error: 'GITHUB_TOKEN or GH_TOKEN not set' },
      },
    });

    expect(report.baselines.provider_path.error).toMatch(/GITHUB_TOKEN/);
    expect(JSON.stringify(report)).not.toContain('pullRequest');
  });
});
