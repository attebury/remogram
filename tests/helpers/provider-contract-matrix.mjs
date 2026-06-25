import { describe, it, expect } from 'vitest';
import { forgePacket, PACKET_TYPES } from '@remogram/core';
import {
  PR_STATUS_BODY_KEYS,
  PR_STATUS_OPTIONAL_BODY_KEYS,
} from './pr-status-contract-keys.mjs';

const ENVELOPE_KEYS = [
  'type',
  'schema_version',
  'provider_id',
  'remote_name',
  'repo_id',
  'base_url',
  'observed_at',
  'ok',
];

const OPTIONAL_BODY_KEYS = {
  [PACKET_TYPES.REPO_STATUS]: ['integration_ref_hints'],
  [PACKET_TYPES.PROVIDER_CAPABILITIES]: [
    'forge_ingest_env_override',
    'forge_ingest_cap_clamped',
    'write_field_env_override',
    'write_field_cap_clamped',
    'write_field_env_invalid',
  ],
  [PACKET_TYPES.PR_STATUS]: PR_STATUS_OPTIONAL_BODY_KEYS,
};

const BODY_KEYS = {
  [PACKET_TYPES.REPO_STATUS]: ['auth_env', 'auth_present', 'capabilities', 'default_branch'],
  [PACKET_TYPES.REF_COMPARE]: [
    'ahead_by',
    'behind_by',
    'compare_base_ref',
    'compare_base_sha',
    'compare_head_ref',
    'compare_head_sha',
  ],
  [PACKET_TYPES.PROVIDER_IDENTITY]: [
    'can_write',
    'login',
    'token_expiry_signal',
    'token_scope_signal',
  ],
  [PACKET_TYPES.BRANCH_PROTECTION]: [
    'approvals_required',
    'branch_ref',
    'protected_branch_rules',
    'required_status_contexts',
  ],
  [PACKET_TYPES.CR_FILES]: ['changed_paths', 'path_count', 'paths_truncated', 'pr_number'],
  [PACKET_TYPES.CR_COMMENTS]: ['comment_count', 'comments', 'comments_truncated', 'pr_number'],
  [PACKET_TYPES.FORGE_CHANGES]: [
    'event_count',
    'events',
    'events_truncated',
    'since',
    'since_kind',
  ],
  [PACKET_TYPES.PR_STATUS]: PR_STATUS_BODY_KEYS,
  [PACKET_TYPES.PR_CHECKS]: [
    'check_conclusion',
    'checks_truncated',
    'failed_contexts',
    'forge_source_sha',
    'missing_required_contexts',
    'pending_contexts',
    'required_contexts',
    'stale_contexts',
    'statuses',
  ],
  [PACKET_TYPES.MERGE_PLAN]: [
    'blockers',
    'checks_conclusion',
    'failed_contexts',
    'mergeability',
    'missing_required_contexts',
    'pending_contexts',
    'pr_number',
    'required_contexts',
    'stale_contexts',
  ],
  [PACKET_TYPES.SYNC_PLAN]: ['blockers', 'diverged', 'local_sha', 'remote', 'remote_sha'],
  [PACKET_TYPES.PROVIDER_CAPABILITIES]: [
    'auth_envs',
    'check_pagination',
    'check_sources',
    'commands',
    'forge_ingest_cap_bytes',
    'host_binding',
    'idempotency_scan',
    'open_pull_list',
    'mergeability_confidence',
    'pagination',
    'read_field_max_bytes',
    'write_field_max_bytes',
    'write_field_uncapped',
    'write_field_policy_source',
    'write_support',
    'write_commands',
  ],
};

const COMPARE_FIELD_KEYS = [
  'compare_base_ref',
  'compare_head_ref',
  'compare_base_sha',
  'compare_head_sha',
];

const FORGE_PR_FIELD_KEYS = [
  'forge_target_branch_ref',
  'forge_source_branch_ref',
  'forge_target_sha',
  'forge_source_sha',
];

function expectNoCompareFields(body) {
  for (const key of COMPARE_FIELD_KEYS) {
    expect(body).not.toHaveProperty(key);
  }
}

function expectNoForgePrFields(body) {
  for (const key of FORGE_PR_FIELD_KEYS) {
    expect(body).not.toHaveProperty(key);
  }
}

const CHECK_CONCLUSIONS = new Set(['success', 'failure', 'pending', 'missing', 'unknown']);
const MERGEABILITIES = new Set(['clean', 'conflicted', 'unknown']);
const MERGE_BLOCKERS = new Set([
  'merge_conflict',
  'pr_not_open',
  'checks_incomplete',
  'checks_failed',
  'checks_missing',
  'checks_pending',
  'required_checks_missing',
  'required_checks_pending',
  'stale_status_context',
  'path_scope_violation',
  'changed_paths_unavailable',
]);
const COMMANDS = new Set([
  'repo_status',
  'ref_compare',
  'ref_inventory',
  'cr_inventory',
  'pr_status',
  'pr_checks',
  'merge_plan',
  'sync_plan',
  'cr_open',
  'issue_open',
  'status_set',
  'whoami',
  'branch_protection',
  'cr_files',
  'cr_comments',
  'issue_status',
  'issue_inventory',
  'issue_comments',
  'forge_changes',
  'merge_execute',
]);
const AUTH_CLASSES = new Set(['none', 'git_only', 'token_required']);

export function jsonResponse(body, status = 200, { headers = {} } = {}) {
  const headerMap = new Map(Object.entries(headers));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (name) => headerMap.get(name) ?? headerMap.get(String(name).toLowerCase()) ?? null,
    },
    body: {
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify(body));
      },
    },
  };
}

function packetCtx(testCase) {
  return {
    providerId: testCase.provider.id,
    remoteName: testCase.ctx.config.remote || 'origin',
    repoId: `${testCase.ctx.config.owner}/${testCase.ctx.config.repo}`,
  };
}

function bodyKeys(packet) {
  return Object.keys(packet).filter((k) => !ENVELOPE_KEYS.includes(k)).sort();
}

export function expectBodyKeys(type, testCase, body) {
  let expected = BODY_KEYS[type];
  if (type === PACKET_TYPES.PROVIDER_CAPABILITIES && !testCase.writeSupport) {
    expected = expected.filter((key) => key !== 'write_commands');
  }
  if (type === PACKET_TYPES.PROVIDER_CAPABILITIES && testCase.provider.id !== 'gitea-api') {
    const includesIdempotencyScan =
      (testCase.provider.id === 'github-api' || testCase.provider.id === 'gitlab-api')
      && testCase.writeSupport;
    if (!includesIdempotencyScan) {
      expected = expected.filter((key) => key !== 'idempotency_scan');
    }
  }
  if (
    type === PACKET_TYPES.PROVIDER_CAPABILITIES
    && !['gitea-api', 'gitlab-api', 'github-api'].includes(testCase.provider.id)
  ) {
    expected = expected.filter((key) => key !== 'open_pull_list');
  }
  const packet = forgePacket(type, packetCtx(testCase), body);
  expect(packet.type).toBe(type);
  expect(packet.provider_id).toBe(testCase.provider.id);
  expect(packet.ok).toBe(true);
  const actual = bodyKeys(packet);
  const optional = OPTIONAL_BODY_KEYS[type] ?? [];
  for (const key of expected) {
    expect(actual).toContain(key);
  }
  for (const key of actual) {
    expect(expected.includes(key) || optional.includes(key)).toBe(true);
  }
}

function expectStatusRows(statuses) {
  expect(Array.isArray(statuses)).toBe(true);
  for (const status of statuses) {
    expect(status).toEqual(
      expect.objectContaining({
        context: expect.any(String),
        state: expect.any(String),
        required: expect.any(Boolean),
        source: expect.any(String),
      }),
    );
    expect(typeof status.description === 'string' || status.description == null).toBe(true);
    expect(['success', 'failure', 'pending', 'unknown', 'error'].includes(status.state)).toBe(true);
    if (status.sha != null) expect(typeof status.sha).toBe('string');
    if (status.stale != null) expect(status.stale).toBe(true);
    if (status.target_url != null) expect(typeof status.target_url).toBe('string');
  }
}

export function runProviderContractMatrix(cases) {
  describe('provider contract matrix', () => {
    for (const testCase of cases) {
      describe(testCase.provider.id, () => {
        it('emits the structured provider_capabilities body shape', async () => {
          const body = await testCase.provider.providerCapabilities(testCase.ctx);

          expect(body.write_support).toBe(testCase.writeSupport ?? false);
          expect(['unsupported', 'first_page_only', 'supported']).toContain(body.pagination);
          expect(['direct', 'derived', 'unknown']).toContain(body.mergeability_confidence);
          expect(Array.isArray(body.auth_envs)).toBe(true);
          expect(Array.isArray(body.check_sources)).toBe(true);
          for (const command of body.commands) {
            expect(COMMANDS.has(command.name)).toBe(true);
            expect(typeof command.implemented).toBe('boolean');
            expect(AUTH_CLASSES.has(command.auth_class)).toBe(true);
          }
          expectBodyKeys(PACKET_TYPES.PROVIDER_CAPABILITIES, testCase, body);
        });

        it('emits the shared repo_status body shape', async () => {
          testCase.useAuth();
          testCase.mockRepoStatus();

          const body = await testCase.provider.repoStatus(testCase.ctx);

          expect(body.auth_present).toBe(true);
          const expectedCaps = [
            'repo_status',
            'ref_compare',
            'ref_inventory',
            'cr_inventory',
            'pr_status',
            'pr_checks',
            'merge_plan',
            'sync_plan',
          ];
          if (testCase.writeSupport) {
            if (testCase.provider.id === 'gitea-api') expectedCaps.push('cr_open');
            expectedCaps.push('status_set');
          }
          expect(body.capabilities).toEqual(expect.arrayContaining(expectedCaps));
          expectBodyKeys(PACKET_TYPES.REPO_STATUS, testCase, body);
        });

        it('gates authenticated commands with the shared unauthenticated error', async () => {
          testCase.clearAuth();

          await expect(testCase.provider.prView(testCase.ctx, testCase.prOpts)).rejects.toMatchObject({
            forgeError: { code: 'unauthenticated_provider' },
          });
          expect(global.fetch).not.toHaveBeenCalled();
        });

        it('emits the shared ref_compare body shape without forge auth', async () => {
          testCase.clearAuth();

          const body = await testCase.provider.refsCompare(testCase.ctx, 'HEAD', 'HEAD');

          expect(body.compare_base_sha).toMatch(/^[0-9a-f]{40}$/);
          expect(body.compare_head_sha).toBe(body.compare_base_sha);
          expectNoForgePrFields(body);
          expectBodyKeys(PACKET_TYPES.REF_COMPARE, testCase, body);
        });

        it('emits ref_inventory body without forge auth', async () => {
          testCase.clearAuth();

          const body = await testCase.provider.refsInventory(testCase.ctx);

          expect(Array.isArray(body.refs)).toBe(true);
          expect(body.refs.length).toBeGreaterThan(0);
          expect(body.refs[0].sha).toMatch(/^[0-9a-f]{40}$/);
        });

        it('gates cr_inventory without forge auth', async () => {
          testCase.clearAuth();

          await expect(testCase.provider.crInventory(testCase.ctx)).rejects.toMatchObject({
            forgeError: { code: 'unauthenticated_provider' },
          });
        });

        if (typeof testCase.provider.statusSet === 'function') {
          it('gates status_set without forge auth', async () => {
            testCase.clearAuth();

            await expect(
              testCase.provider.statusSet(testCase.ctx, {
                sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                context: 'verify/wave1',
                state: 'success',
              }),
            ).rejects.toMatchObject({
              forgeError: { code: 'unauthenticated_provider' },
            });
            expect(global.fetch).not.toHaveBeenCalled();
          });

          it('gates status_set without write_commands in config', async () => {
            testCase.useAuth();
            const ctxNoWrites = {
              ...testCase.ctx,
              config: { ...testCase.ctx.config, write_commands: undefined },
            };

            await expect(
              testCase.provider.statusSet(ctxNoWrites, {
                sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                context: 'verify/wave1',
                state: 'success',
              }),
            ).rejects.toMatchObject({
              forgeError: { code: 'write_not_configured' },
            });
            expect(global.fetch).not.toHaveBeenCalled();
          });

          it('emits commit_status_set body when authenticated', async () => {
            if (typeof testCase.mockStatusSet !== 'function') return;
            testCase.useAuth();
            testCase.mockStatusSet();

            const body = await testCase.provider.statusSet(testCase.ctx, {
              sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              context: 'verify/wave1',
              state: 'success',
              description: 'Verification passed',
            });

            expect(body.sha).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
            expect(body.context).toBe('verify/wave1');
            expect(body.state).toBe('success');
            expect(body.description).toBe('Verification passed');
          });
        }

        if (typeof testCase.provider.crOpen === 'function') {
          it('gates cr_open without forge auth', async () => {
            testCase.clearAuth();

            await expect(
              testCase.provider.crOpen(testCase.ctx, {
                head: 'feat/x',
                base: 'remo',
                title: 'Test',
              }),
            ).rejects.toMatchObject({
              forgeError: { code: 'unauthenticated_provider' },
            });
            expect(global.fetch).not.toHaveBeenCalled();
          });

          it('gates cr_open without write_commands in config', async () => {
            testCase.useAuth();
            const ctxNoWrites = {
              ...testCase.ctx,
              config: { ...testCase.ctx.config, write_commands: undefined },
            };

            await expect(
              testCase.provider.crOpen(ctxNoWrites, {
                head: 'feat/x',
                base: 'remo',
                title: 'Test',
              }),
            ).rejects.toMatchObject({
              forgeError: { code: 'write_not_configured' },
            });
            expect(global.fetch).not.toHaveBeenCalled();
          });

          it('emits change_request_opened body when authenticated', async () => {
            if (typeof testCase.mockCrOpen !== 'function') return;
            testCase.useAuth();
            testCase.mockCrOpen();

            const body = await testCase.provider.crOpen(testCase.ctx, {
              head: 'feat/x',
              base: 'remo',
              title: 'Test CR',
            });

            expect(body.pr_number).toBeGreaterThan(0);
            expect(typeof body.url).toBe('string');
            expect(body.head).toBe('feat/x');
            expect(body.base).toBe('remo');
            expect(body.title).toBe('Test CR');
          });
        }

        it('emits cr_inventory_slice body when authenticated', async () => {
          if (typeof testCase.mockCrInventory !== 'function') return;
          testCase.useAuth();
          testCase.mockCrInventory();

          const body = await testCase.provider.crInventory(testCase.ctx);

          expect(Array.isArray(body.entries)).toBe(true);
          expect(body.entries[0].pr_number).toBe(testCase.prOpts.number);
          expect(body.entries[0].checks_conclusion).toBeDefined();
          expect(typeof body.entries[0].checks_truncated).toBe('boolean');
          expect(Array.isArray(body.entries[0].blockers)).toBe(true);
          expect(typeof body.entry_count).toBe('number');
          expect(typeof body.truncated).toBe('boolean');
          expect(typeof body.list_truncated).toBe('boolean');
          expect(typeof body.has_more).toBe('boolean');
          expect(typeof body.complete).toBe('boolean');
          expect(typeof body.entry_count_observed).toBe('number');
          expect(body.entries[0].head_reconcile).toBeDefined();
          if (body.entries[0].forge_target_sha) {
            expect(body.entries[0].forge_target_sha).toMatch(/^[0-9a-f]+$/i);
          }
          if (body.entries[0].forge_source_sha) {
            expect(body.entries[0].forge_source_sha).toMatch(/^[0-9a-f]+$/i);
          }
        });

        it('rejects option-looking refs with the shared invalid_args code', async () => {
          testCase.useAuth();

          await expect(testCase.provider.prChecks(testCase.ctx, { ref: '--show-toplevel' })).rejects
            .toMatchObject({
              forgeError: { code: 'invalid_args' },
            });
        });

        it('emits the shared pr_status body shape and mergeability vocabulary', async () => {
          testCase.useAuth();
          testCase.mockPrView();

          const body = await testCase.provider.prView(testCase.ctx, testCase.prOpts);

          expect(MERGEABILITIES.has(body.mergeability)).toBe(true);
          expectNoCompareFields(body);
          expectBodyKeys(PACKET_TYPES.PR_STATUS, testCase, body);
        });

        it('emits the shared pr_checks body shape and check vocabulary', async () => {
          testCase.useAuth();
          testCase.mockPrChecksSuccess();

          const body = await testCase.provider.prChecks(testCase.ctx, testCase.prOpts);

          expect(CHECK_CONCLUSIONS.has(body.check_conclusion)).toBe(true);
          expect(typeof body.checks_truncated).toBe('boolean');
          expectStatusRows(body.statuses);
          expectBodyKeys(PACKET_TYPES.PR_CHECKS, testCase, body);
        });

        it('emits the shared merge_plan shape for missing checks', async () => {
          testCase.useAuth();
          testCase.mockMergePlanMissingChecks();

          const body = await testCase.provider.mergePlan(testCase.ctx, testCase.prOpts);

          expect(MERGEABILITIES.has(body.mergeability)).toBe(true);
          expect(CHECK_CONCLUSIONS.has(body.checks_conclusion)).toBe(true);
          expect(body.checks_conclusion).toBe('missing');
          expect(body.blockers).toContain('checks_missing');
          for (const blocker of body.blockers) expect(MERGE_BLOCKERS.has(blocker)).toBe(true);
          expectBodyKeys(PACKET_TYPES.MERGE_PLAN, testCase, body);
        });

        it('emits the shared sync_plan body shape without forge auth', async () => {
          testCase.clearAuth();

          const body = await testCase.provider.syncPlan(testCase.ctx, 'origin');

          expect(Array.isArray(body.blockers)).toBe(true);
          expectBodyKeys(PACKET_TYPES.SYNC_PLAN, testCase, body);
        });

        if (typeof testCase.provider.whoami === 'function') {
          it('emits provider_identity body when authenticated', async () => {
            if (typeof testCase.mockWhoami !== 'function') return;
            testCase.useAuth();
            testCase.mockWhoami();

            const body = await testCase.provider.whoami(testCase.ctx);

            expect(typeof body.login).toBe('string');
            expect(typeof body.can_write).toBe('boolean');
            if (testCase.expectScopeImplemented === true) {
              expect(body.token_scope_signal.implemented).toBe(true);
            } else {
              expect(body.token_scope_signal.implemented).toBe(false);
            }
            expectBodyKeys(PACKET_TYPES.PROVIDER_IDENTITY, testCase, body);
          });

          it('gates whoami without forge auth', async () => {
            testCase.clearAuth();

            await expect(testCase.provider.whoami(testCase.ctx)).rejects.toMatchObject({
              forgeError: { code: 'unauthenticated_provider' },
            });
            expect(global.fetch).not.toHaveBeenCalled();
          });
        }

        if (typeof testCase.provider.branchProtection === 'function') {
          it('emits branch_protection body when authenticated', async () => {
            if (typeof testCase.mockBranchProtection !== 'function') return;
            testCase.useAuth();
            testCase.mockBranchProtection();

            const body = await testCase.provider.branchProtection(testCase.ctx, {
              branchRef: 'remo',
            });

            expect(body.branch_ref).toBe('remo');
            expect(Array.isArray(body.required_status_contexts)).toBe(true);
            expect(Array.isArray(body.protected_branch_rules)).toBe(true);
            expect(typeof body.approvals_required?.implemented).toBe('boolean');
            expectBodyKeys(PACKET_TYPES.BRANCH_PROTECTION, testCase, body);
          });

          it('gates branch protection without forge auth', async () => {
            testCase.clearAuth();

            await expect(
              testCase.provider.branchProtection(testCase.ctx, { branchRef: 'remo' }),
            ).rejects.toMatchObject({
              forgeError: { code: 'unauthenticated_provider' },
            });
            expect(global.fetch).not.toHaveBeenCalled();
          });
        }

        if (typeof testCase.provider.crFiles === 'function') {
          it('emits cr_files body when authenticated', async () => {
            if (typeof testCase.mockCrFiles !== 'function') return;
            testCase.useAuth();
            testCase.mockCrFiles();

            const body = await testCase.provider.crFiles(testCase.ctx, { number: 1 });

            expect(body.pr_number).toBe(1);
            expect(Array.isArray(body.changed_paths)).toBe(true);
            expect(typeof body.paths_truncated).toBe('boolean');
            expect(typeof body.path_count).toBe('number');
            expectBodyKeys(PACKET_TYPES.CR_FILES, testCase, body);
          });

          it('gates cr files without forge auth', async () => {
            testCase.clearAuth();

            await expect(testCase.provider.crFiles(testCase.ctx, { number: 1 })).rejects.toMatchObject(
              {
                forgeError: { code: 'unauthenticated_provider' },
              },
            );
            expect(global.fetch).not.toHaveBeenCalled();
          });
        }

        if (typeof testCase.provider.crComments === 'function') {
          it('emits cr_comments body when authenticated', async () => {
            if (typeof testCase.mockCrComments !== 'function') return;
            testCase.useAuth();
            testCase.mockCrComments();

            const body = await testCase.provider.crComments(testCase.ctx, { number: 1 });

            expect(body.pr_number).toBe(1);
            expect(Array.isArray(body.comments)).toBe(true);
            expect(typeof body.comments_truncated).toBe('boolean');
            expect(typeof body.comment_count).toBe('number');
            expectBodyKeys(PACKET_TYPES.CR_COMMENTS, testCase, body);
          });

          it('gates cr comments without forge auth', async () => {
            testCase.clearAuth();

            await expect(
              testCase.provider.crComments(testCase.ctx, { number: 1 }),
            ).rejects.toMatchObject({
              forgeError: { code: 'unauthenticated_provider' },
            });
            expect(global.fetch).not.toHaveBeenCalled();
          });
        }

        if (typeof testCase.provider.forgeChanges === 'function') {
          it('emits forge_changes body when authenticated', async () => {
            if (typeof testCase.mockForgeChanges !== 'function') return;
            testCase.useAuth();
            testCase.mockForgeChanges();

            const body = await testCase.provider.forgeChanges(testCase.ctx, {
              since: '2024-06-01T12:00:00.000Z',
            });

            expect(body.since).toBe('2024-06-01T12:00:00.000Z');
            expect(body.since_kind).toBe('observed_at');
            expect(Array.isArray(body.events)).toBe(true);
            expect(typeof body.events_truncated).toBe('boolean');
            expect(typeof body.event_count).toBe('number');
            expectBodyKeys(PACKET_TYPES.FORGE_CHANGES, testCase, body);
          });

          it('gates forge changes without forge auth', async () => {
            testCase.clearAuth();

            await expect(
              testCase.provider.forgeChanges(testCase.ctx, {
                since: '2024-06-01T12:00:00.000Z',
              }),
            ).rejects.toMatchObject({
              forgeError: { code: 'unauthenticated_provider' },
            });
            expect(global.fetch).not.toHaveBeenCalled();
          });
        }
      });
    }
  });
}
