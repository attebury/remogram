import { describe, it, expect } from 'vitest';
import { forgePacket, PACKET_TYPES } from '@remogram/core';

const ENVELOPE_KEYS = [
  'type',
  'schema_version',
  'provider_id',
  'remote_name',
  'repo_id',
  'observed_at',
  'ok',
];

const BODY_KEYS = {
  [PACKET_TYPES.REPO_STATUS]: ['auth_env', 'auth_present', 'capabilities', 'default_branch'],
  [PACKET_TYPES.REF_COMPARE]: [
    'ahead_by',
    'base_ref',
    'base_sha',
    'behind_by',
    'head_ref',
    'head_sha',
  ],
  [PACKET_TYPES.PR_STATUS]: [
    'base_ref',
    'base_sha',
    'head_ref',
    'head_sha',
    'mergeability',
    'pr_number',
    'state',
    'title',
    'url',
  ],
  [PACKET_TYPES.PR_CHECKS]: ['check_conclusion', 'head_sha', 'statuses'],
  [PACKET_TYPES.MERGE_PLAN]: ['blockers', 'checks_conclusion', 'mergeability', 'pr_number'],
  [PACKET_TYPES.SYNC_PLAN]: ['blockers', 'diverged', 'local_sha', 'remote', 'remote_sha'],
  [PACKET_TYPES.PROVIDER_CAPABILITIES]: [
    'auth_envs',
    'check_sources',
    'commands',
    'forge_ingest_cap_bytes',
    'host_binding',
    'mergeability_confidence',
    'pagination',
    'write_support',
  ],
};

const CHECK_CONCLUSIONS = new Set(['success', 'failure', 'pending', 'missing', 'unknown']);
const MERGEABILITIES = new Set(['clean', 'conflicted', 'unknown']);
const MERGE_BLOCKERS = new Set([
  'merge_conflict',
  'pr_not_open',
  'checks_failed',
  'checks_missing',
  'checks_pending',
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
]);
const AUTH_CLASSES = new Set(['none', 'git_only', 'token_required']);

export function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: () => null,
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

function expectBodyKeys(type, testCase, body) {
  const packet = forgePacket(type, packetCtx(testCase), body);
  expect(packet.type).toBe(type);
  expect(packet.provider_id).toBe(testCase.provider.id);
  expect(packet.ok).toBe(true);
  expect(bodyKeys(packet)).toEqual(BODY_KEYS[type]);
}

function expectStatusRows(statuses) {
  expect(Array.isArray(statuses)).toBe(true);
  for (const status of statuses) {
    expect(Object.keys(status).sort()).toEqual(['context', 'description', 'state']);
    expect(typeof status.context === 'string' || status.context == null).toBe(true);
    expect(typeof status.description === 'string' || status.description == null).toBe(true);
    expect(['success', 'failure', 'pending', 'unknown', 'error'].includes(status.state)).toBe(true);
  }
}

export function runProviderContractMatrix(cases) {
  describe('provider contract matrix', () => {
    for (const testCase of cases) {
      describe(testCase.provider.id, () => {
        it('emits the structured provider_capabilities body shape', async () => {
          const body = await testCase.provider.providerCapabilities(testCase.ctx);

          expect(body.write_support).toBe(false);
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
          expect(body.capabilities).toEqual(
            expect.arrayContaining([
              'repo_status',
              'ref_compare',
              'ref_inventory',
              'cr_inventory',
              'pr_status',
              'pr_checks',
              'merge_plan',
              'sync_plan',
            ]),
          );
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

          expect(body.base_sha).toMatch(/^[0-9a-f]{40}$/);
          expect(body.head_sha).toBe(body.base_sha);
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

        it('emits cr_inventory_slice body when authenticated', async () => {
          if (typeof testCase.mockCrInventory !== 'function') return;
          testCase.useAuth();
          testCase.mockCrInventory();

          const body = await testCase.provider.crInventory(testCase.ctx);

          expect(Array.isArray(body.entries)).toBe(true);
          expect(body.entries[0].pr_number).toBe(testCase.prOpts.number);
          expect(body.entries[0].checks_conclusion).toBeDefined();
          expect(Array.isArray(body.entries[0].blockers)).toBe(true);
          expect(typeof body.entry_count).toBe('number');
          expect(typeof body.truncated).toBe('boolean');
          expect(typeof body.list_truncated).toBe('boolean');
          expect(body.entries[0].head_reconcile).toBeDefined();
          if (body.entries[0].base_sha) {
            expect(body.entries[0].base_sha).toMatch(/^[0-9a-f]+$/i);
          }
          if (body.entries[0].head_sha) {
            expect(body.entries[0].head_sha).toMatch(/^[0-9a-f]+$/i);
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
          expectBodyKeys(PACKET_TYPES.PR_STATUS, testCase, body);
        });

        it('emits the shared pr_checks body shape and check vocabulary', async () => {
          testCase.useAuth();
          testCase.mockPrChecksSuccess();

          const body = await testCase.provider.prChecks(testCase.ctx, testCase.prOpts);

          expect(CHECK_CONCLUSIONS.has(body.check_conclusion)).toBe(true);
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
      });
    }
  });
}
