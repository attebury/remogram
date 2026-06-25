import { describe, it, expect } from 'vitest';
import {
  buildBranchProtectionBody,
  buildBranchProtectionFromGiteaProtection,
  buildBranchProtectionFromGitHubProtection,
  buildBranchProtectionFromGitLabProtection,
  unimplementedApprovalsRequiredSignal,
  forgePacket,
  PACKET_TYPES,
  FORBIDDEN_PACKET_KEYS,
  MAX_BRANCH_PROTECTION_STATUS_CONTEXTS,
} from '@remogram/core';

const ctx = {
  providerId: 'gitea-api',
  remoteName: 'origin',
  repoId: 'owner/repo',
};

describe('branch protection normalization', () => {
  it('builds branch_protection body from Gitea protection payload', () => {
    const body = buildBranchProtectionFromGiteaProtection('remo', {
      branch_name: 'remo',
      enable_status_check: true,
      status_check_contexts: ['ci/test', 'ci/lint'],
      required_approvals: 1,
    });
    expect(body.branch_ref).toBe('remo');
    expect(body.required_status_contexts).toEqual(['ci/test', 'ci/lint']);
    expect(body.protected_branch_rules).toEqual([{ name: 'remo' }]);
    expect(body.approvals_required).toEqual({ implemented: true, count: 1 });
  });

  it('honest unimplemented approvals signal when required_approvals absent', () => {
    const body = buildBranchProtectionFromGiteaProtection('main', {
      branch_name: 'main',
      status_check_contexts: ['ci/gate'],
    });
    expect(body.approvals_required).toEqual(unimplementedApprovalsRequiredSignal());
  });

  it('clears required contexts when status checks disabled', () => {
    const body = buildBranchProtectionFromGiteaProtection('main', {
      branch_name: 'main',
      enable_status_check: false,
      status_check_contexts: ['ci/gate'],
    });
    expect(body.required_status_contexts).toEqual([]);
  });

  it('caps and sanitizes required status contexts', () => {
    const contexts = Array.from({ length: MAX_BRANCH_PROTECTION_STATUS_CONTEXTS + 5 }, (_, i) =>
      String(i),
    );
    const body = buildBranchProtectionBody({
      branch_ref: 'main',
      required_status_contexts: contexts,
      protected_branch_rules: [{ name: 'main' }],
      approvals_required: unimplementedApprovalsRequiredSignal(),
    });
    expect(body.required_status_contexts).toHaveLength(MAX_BRANCH_PROTECTION_STATUS_CONTEXTS);
  });

  it('sanitizes branch_ref and strips forbidden workflow keys from packet', () => {
    const body = buildBranchProtectionBody({
      branch_ref: 'remo\ninjected',
      required_status_contexts: ['ci/test'],
      protected_branch_rules: [{ name: 'remo' }],
      approvals_required: unimplementedApprovalsRequiredSignal(),
    });
    const packet = forgePacket(PACKET_TYPES.BRANCH_PROTECTION, ctx, body);
    expect(packet.type).toBe('branch_protection');
    expect(packet.branch_ref).not.toContain('\n');
    for (const key of FORBIDDEN_PACKET_KEYS) {
      expect(packet[key]).toBeUndefined();
    }
  });

  it('builds branch_protection body from GitHub protection payload', () => {
    const body = buildBranchProtectionFromGitHubProtection('main', {
      required_status_checks: {
        contexts: ['CI Gate / CI gate (pull_request)', 'ci/lint'],
      },
      required_pull_request_reviews: {
        required_approving_review_count: 2,
      },
    });
    expect(body.branch_ref).toBe('main');
    expect(body.required_status_contexts).toEqual([
      'CI Gate / CI gate (pull_request)',
      'ci/lint',
    ]);
    expect(body.protected_branch_rules).toEqual([{ name: 'main' }]);
    expect(body.approvals_required).toEqual({ implemented: true, count: 2 });
  });

  it('GitHub null protection yields empty policy with honest approvals signal', () => {
    const body = buildBranchProtectionFromGitHubProtection('main', null);
    expect(body.required_status_contexts).toEqual([]);
    expect(body.protected_branch_rules).toEqual([]);
    expect(body.approvals_required).toEqual(unimplementedApprovalsRequiredSignal());
  });

  it('GitHub omits review count when sub-fact absent', () => {
    const body = buildBranchProtectionFromGitHubProtection('main', {
      required_status_checks: { contexts: ['ci/test'] },
    });
    expect(body.approvals_required).toEqual(unimplementedApprovalsRequiredSignal());
  });

  it('builds branch_protection body from GitLab protected branch and approval rules', () => {
    const body = buildBranchProtectionFromGitLabProtection('main', {
      protectedBranch: { name: 'main' },
      approvalRules: [{ approvals_required: 2, protected_branches: [{ name: 'main' }] }],
    });
    expect(body.branch_ref).toBe('main');
    expect(body.required_status_contexts).toEqual([]);
    expect(body.protected_branch_rules).toEqual([{ name: 'main' }]);
    expect(body.approvals_required).toEqual({ implemented: true, count: 2 });
  });

  it('GitLab null protected branch yields empty policy', () => {
    const body = buildBranchProtectionFromGitLabProtection('main', { protectedBranch: null });
    expect(body.protected_branch_rules).toEqual([]);
    expect(body.approvals_required).toEqual(unimplementedApprovalsRequiredSignal());
  });
});
