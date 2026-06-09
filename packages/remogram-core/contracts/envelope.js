import { sanitizeField } from '../caps.js';

export const SCHEMA_VERSION = 1;

export const PACKET_TYPES = {
  REPO_STATUS: 'repo_status',
  REF_COMPARE: 'ref_compare',
  PR_STATUS: 'pr_status',
  PR_CHECKS: 'pr_checks',
  MERGE_PLAN: 'merge_plan',
  SYNC_PLAN: 'sync_plan',
  FORGE_ERROR: 'forge_error',
};

export const FORBIDDEN_PACKET_KEYS = new Set([
  'goal_branch',
  'lane',
  'sdlc_task',
  'queue_selectable',
]);

function assertNoForbiddenKeys(value) {
  if (value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PACKET_KEYS.has(key)) {
      throw new Error(`Forbidden Topogram concept in remogram output: ${key}`);
    }
    assertNoForbiddenKeys(nested);
  }
}

export function forgePacket(type, context, body = {}, error = null) {
  assertNoForbiddenKeys(body);

  const packet = {
    ...body,
    type,
    schema_version: SCHEMA_VERSION,
    provider_id: context.providerId,
    remote_name: context.remoteName,
    repo_id: context.repoId,
    observed_at: new Date().toISOString(),
    ok: error == null,
  };

  if (error) {
    packet.error_code = error.code;
    packet.error_message = sanitizeField(error.message);
    if (error.status != null) packet.error_status = error.status;
  }

  return packet;
}

export function forgeErrorPacket(context, error, type = PACKET_TYPES.FORGE_ERROR) {
  return forgePacket(type, context, {}, error);
}

export function unknownForgeContext() {
  return {
    providerId: 'unknown',
    remoteName: 'origin',
    repoId: 'unknown/unknown',
  };
}
