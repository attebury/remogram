import { describe, it, expect } from 'vitest';
import {
  assertExpectedSha,
  buildMergeExecuteBeforeFacts,
  collectMergeExecuteBlockers,
  buildCrMergeBlockedBody,
  buildCrMergedBody,
  PACKET_TYPES,
  forgePacket,
  FORBIDDEN_PACKET_KEYS,
} from '@remogram/core';

const BASE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HEAD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const forgeOnlyView = {
  state: 'open',
  forge_target_sha: BASE,
  forge_source_sha: HEAD,
  forge_source_branch_ref: 'feat/x',
  mergeability: 'clean',
};

const forgeOnlyChecks = {
  forge_source_sha: HEAD,
  check_conclusion: 'success',
  checks_truncated: false,
};

describe('merge execute helpers', () => {
  it('assertExpectedSha rejects invalid SHAs', () => {
    expect(() => assertExpectedSha('short', '--expected-head-sha')).toThrow(
      expect.objectContaining({ invalidArgs: expect.stringContaining('40-character') }),
    );
  });

  it('collectMergeExecuteBlockers detects SHA mismatches', () => {
    const view = {
      state: 'open',
      base_sha: BASE,
      head_sha: HEAD,
      head_ref: 'feat/x',
      mergeability: 'clean',
    };
    const checks = { check_conclusion: 'success', checks_truncated: false };
    const mergePlanBody = { blockers: [] };
    const blockers = collectMergeExecuteBlockers(
      view,
      checks,
      mergePlanBody,
      { baseSha: 'cccccccccccccccccccccccccccccccccccccccc', headSha: HEAD },
      { forgeHeadRefSha: HEAD },
    );
    expect(blockers).toContain('base_sha_mismatch');
  });

  it('collectMergeExecuteBlockers detects head_ref_moved when forge branch tip differs', () => {
    const view = {
      state: 'open',
      base_sha: BASE,
      head_sha: HEAD,
      head_ref: 'feat/x',
      mergeability: 'clean',
    };
    const checks = { check_conclusion: 'success', checks_truncated: false };
    const mergePlanBody = { blockers: [] };
    const blockers = collectMergeExecuteBlockers(
      view,
      checks,
      mergePlanBody,
      { baseSha: BASE, headSha: HEAD },
      { forgeHeadRefSha: 'cccccccccccccccccccccccccccccccccccccccc' },
    );
    expect(blockers).toContain('head_ref_moved');
  });

  it('collectMergeExecuteBlockers allows matching forge branch tip', () => {
    const view = {
      state: 'open',
      base_sha: BASE,
      head_sha: HEAD,
      head_ref: 'feat/x',
      mergeability: 'clean',
    };
    const checks = { check_conclusion: 'success', checks_truncated: false };
    const mergePlanBody = { blockers: [] };
    const blockers = collectMergeExecuteBlockers(
      view,
      checks,
      mergePlanBody,
      { baseSha: BASE, headSha: HEAD },
      { forgeHeadRefSha: HEAD },
    );
    expect(blockers).not.toContain('head_ref_moved');
  });

  it('collectMergeExecuteBlockers detects checks_head_sha_mismatch', () => {
    const checksSha = 'cccccccccccccccccccccccccccccccccccccccc';
    const view = {
      state: 'open',
      base_sha: BASE,
      head_sha: HEAD,
      head_ref: 'feat/x',
      mergeability: 'clean',
    };
    const checks = {
      head_sha: checksSha,
      check_conclusion: 'success',
      checks_truncated: false,
    };
    const blockers = collectMergeExecuteBlockers(
      view,
      checks,
      { blockers: [] },
      { baseSha: BASE, headSha: HEAD },
      { forgeHeadRefSha: HEAD },
    );
    expect(blockers).toContain('checks_head_sha_mismatch');
  });

  it('collectMergeExecuteBlockers detects forge_pr_head_mismatch', () => {
    const forgeSha = 'cccccccccccccccccccccccccccccccccccccccc';
    const view = {
      state: 'open',
      base_sha: BASE,
      head_sha: HEAD,
      head_ref: 'feat/x',
      mergeability: 'clean',
    };
    const checks = {
      head_sha: HEAD,
      check_conclusion: 'success',
      checks_truncated: false,
    };
    const blockers = collectMergeExecuteBlockers(
      view,
      checks,
      { blockers: [] },
      { baseSha: BASE, headSha: HEAD },
      { forgeHeadRefSha: forgeSha },
    );
    expect(blockers).toContain('forge_pr_head_mismatch');
    expect(blockers).toContain('head_ref_moved');
  });

  it('collectMergeExecuteBlockers allows aligned view, checks, and forge SHAs', () => {
    const view = {
      state: 'open',
      base_sha: BASE,
      head_sha: HEAD,
      head_ref: 'feat/x',
      mergeability: 'clean',
    };
    const checks = {
      head_sha: HEAD,
      check_conclusion: 'success',
      checks_truncated: false,
    };
    const blockers = collectMergeExecuteBlockers(
      view,
      checks,
      { blockers: [] },
      { baseSha: BASE, headSha: HEAD },
      { forgeHeadRefSha: HEAD },
    );
    expect(blockers).not.toContain('checks_head_sha_mismatch');
    expect(blockers).not.toContain('forge_pr_head_mismatch');
    expect(blockers).not.toContain('checks_forge_head_mismatch');
    expect(blockers).not.toContain('head_ref_moved');
  });

  it('collectMergeExecuteBlockers detects checks_forge_head_mismatch', () => {
    const forgeSha = 'dddddddddddddddddddddddddddddddddddddddd';
    const view = {
      state: 'open',
      base_sha: BASE,
      head_sha: HEAD,
      head_ref: 'feat/x',
      mergeability: 'clean',
    };
    const checks = {
      head_sha: HEAD,
      check_conclusion: 'success',
      checks_truncated: false,
    };
    const blockers = collectMergeExecuteBlockers(
      view,
      checks,
      { blockers: [] },
      { baseSha: BASE, headSha: HEAD },
      { forgeHeadRefSha: forgeSha },
    );
    expect(blockers).toContain('checks_forge_head_mismatch');
    expect(blockers).not.toContain('checks_head_sha_mismatch');
  });

  it('buildMergeExecuteBeforeFacts records checks_head_sha', () => {
    const before = buildMergeExecuteBeforeFacts(
      { base_sha: BASE, head_sha: HEAD, mergeability: 'clean' },
      { head_sha: HEAD, check_conclusion: 'success', checks_truncated: false },
      { blockers: [] },
      HEAD,
    );
    expect(before.checks_head_sha).toBe(HEAD);
  });

  it('buildMergeExecuteBeforeFacts records forge_head_ref_sha', () => {
    const before = buildMergeExecuteBeforeFacts(
      { base_sha: BASE, head_sha: HEAD, mergeability: 'clean' },
      { check_conclusion: 'success', checks_truncated: false },
      { blockers: [] },
      HEAD,
    );
    expect(before.forge_head_ref_sha).toBe(HEAD);
  });

  it('collectMergeExecuteBlockers detects checks truncation', () => {
    const view = {
      state: 'open',
      base_sha: BASE,
      head_sha: HEAD,
      mergeability: 'clean',
    };
    const checks = { check_conclusion: 'success', checks_truncated: true };
    const blockers = collectMergeExecuteBlockers(
      view,
      checks,
      { blockers: [] },
      { baseSha: BASE, headSha: HEAD },
    );
    expect(blockers).toContain('checks_incomplete');
  });

  it('collectMergeExecuteBlockers omits checks_missing when policy allows', () => {
    const view = {
      state: 'open',
      base_sha: BASE,
      head_sha: HEAD,
      mergeability: 'clean',
    };
    const checks = { check_conclusion: 'missing', checks_truncated: false };
    const blockers = collectMergeExecuteBlockers(
      view,
      checks,
      { blockers: [] },
      { baseSha: BASE, headSha: HEAD },
      { forgeHeadRefSha: HEAD, mergePolicy: { allow_missing_checks: true } },
    );
    expect(blockers).toEqual([]);
  });

  it('collectMergeExecuteBlockers allows aligned forge-only view and checks', () => {
    const blockers = collectMergeExecuteBlockers(
      forgeOnlyView,
      forgeOnlyChecks,
      { blockers: [] },
      { baseSha: BASE, headSha: HEAD },
      { forgeHeadRefSha: HEAD },
    );
    expect(blockers).not.toContain('checks_head_sha_mismatch');
    expect(blockers).not.toContain('head_ref_moved');
    expect(blockers).toHaveLength(0);
  });

  it('collectMergeExecuteBlockers detects checks_head_sha_mismatch with forge-only shapes', () => {
    const checksSha = 'cccccccccccccccccccccccccccccccccccccccc';
    const blockers = collectMergeExecuteBlockers(
      forgeOnlyView,
      { ...forgeOnlyChecks, forge_source_sha: checksSha },
      { blockers: [] },
      { baseSha: BASE, headSha: HEAD },
      { forgeHeadRefSha: HEAD },
    );
    expect(blockers).toContain('checks_head_sha_mismatch');
  });

  it('collectMergeExecuteBlockers detects head_ref_moved with forge-only shapes', () => {
    const blockers = collectMergeExecuteBlockers(
      forgeOnlyView,
      forgeOnlyChecks,
      { blockers: [] },
      { baseSha: BASE, headSha: HEAD },
      { forgeHeadRefSha: 'cccccccccccccccccccccccccccccccccccccccc' },
    );
    expect(blockers).toContain('head_ref_moved');
  });

  it('buildCrMergedBody shapes success packet fields', () => {
    const ctx = { providerId: 'gitea-api', remoteName: 'origin', repoId: 'o/r' };
    const body = buildCrMergedBody({
      prNumber: 7,
      expected: { baseSha: BASE, headSha: HEAD },
      before: { base_sha: BASE, head_sha: HEAD, blockers: [] },
      merge: { method: 'merge', commit_sha: 'dddddddddddddddddddddddddddddddddddddddd' },
      after: { state: 'merged', base_sha: BASE, head_sha: HEAD },
    });
    const packet = forgePacket(PACKET_TYPES.CR_MERGED, ctx, body);
    expect(packet.ok).toBe(true);
    expect(packet.type).toBe('cr_merged');
    expect(packet.change_request).toEqual({ number: 7, state: 'merged' });
    expect(packet.expected.base_sha).toBe(BASE);
  });

  it('buildCrMergeBlockedBody shapes blocked packet fields', () => {
    const ctx = { providerId: 'gitea-api', remoteName: 'origin', repoId: 'o/r' };
    const body = buildCrMergeBlockedBody({
      prNumber: 7,
      expected: { baseSha: BASE, headSha: HEAD },
      before: { base_sha: BASE, head_sha: HEAD },
      blockers: ['head_sha_mismatch'],
    });
    const packet = forgePacket(
      PACKET_TYPES.CR_MERGE_BLOCKED,
      ctx,
      body,
      { code: 'merge_blocked', message: 'Merge blocked by preflight' },
    );
    expect(packet.ok).toBe(false);
    expect(packet.error_code).toBe('merge_blocked');
    expect(packet.blockers).toEqual(['head_sha_mismatch']);
  });

  it('cr_merged packet excludes forbidden keys', () => {
    const ctx = { providerId: 'gitea-api', remoteName: 'origin', repoId: 'o/r' };
    const packet = forgePacket(
      PACKET_TYPES.CR_MERGED,
      ctx,
      buildCrMergedBody({
        prNumber: 7,
        expected: { baseSha: BASE, headSha: HEAD },
        before: { base_sha: BASE, head_sha: HEAD, blockers: [] },
        merge: { method: 'merge', commit_sha: 'dddddddddddddddddddddddddddddddddddddddd' },
        after: { state: 'merged', base_sha: BASE, head_sha: HEAD },
      }),
    );
    for (const key of FORBIDDEN_PACKET_KEYS) {
      expect(packet).not.toHaveProperty(key);
    }
  });

  it('cr_merge_blocked packet excludes forbidden keys', () => {
    const ctx = { providerId: 'gitea-api', remoteName: 'origin', repoId: 'o/r' };
    const packet = forgePacket(
      PACKET_TYPES.CR_MERGE_BLOCKED,
      ctx,
      buildCrMergeBlockedBody({
        prNumber: 7,
        expected: { baseSha: BASE, headSha: HEAD },
        before: { base_sha: BASE, head_sha: HEAD },
        blockers: ['head_sha_mismatch'],
      }),
      { code: 'merge_blocked', message: 'Merge blocked by preflight' },
    );
    for (const key of FORBIDDEN_PACKET_KEYS) {
      expect(packet).not.toHaveProperty(key);
    }
  });
});
