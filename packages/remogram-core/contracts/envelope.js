import { sanitizeField } from '../caps.js';
import { normalizeForgeErrorFields } from './forge-error-fields.js';

export const SCHEMA_VERSION = 1;

export const PACKET_TYPES = {
  REPO_STATUS: 'repo_status',
  REF_COMPARE: 'ref_compare',
  PR_STATUS: 'pr_status',
  PR_CHECKS: 'pr_checks',
  MERGE_PLAN: 'merge_plan',
  SYNC_PLAN: 'sync_plan',
  PROVIDER_CAPABILITIES: 'provider_capabilities',
  PROVIDER_DOCTOR: 'provider_doctor',
  FORGE_ERROR: 'forge_error',
  CHANGE_REQUEST_OPENED: 'change_request_opened',
  ISSUE_OPENED: 'issue_opened',
  ISSUE_STATUS: 'issue_status',
  ISSUE_INVENTORY_SLICE: 'issue_inventory_slice',
  ISSUE_COMMENTS: 'issue_comments',
  COMMIT_STATUS_SET: 'commit_status_set',
  PROVIDER_IDENTITY: 'provider_identity',
  BRANCH_PROTECTION: 'branch_protection',
  CR_FILES: 'cr_files',
  CR_COMMENTS: 'cr_comments',
  FORGE_CHANGES: 'forge_changes',
  CR_MERGED: 'cr_merged',
  CR_MERGE_BLOCKED: 'cr_merge_blocked',
  CR_MERGE_INDETERMINATE: 'cr_merge_indeterminate',
  COMMAND_CONTRACT_EXPORT: 'command_contract_export',
  VERIFY_BIND: 'verify_bind',
  REVIEW_BUNDLE: 'review_bundle',
  ISSUE_BUNDLE: 'issue_bundle',
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
      throw new Error(`Forbidden workflow/planning-tool key in remogram output: ${key}`);
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

  delete packet.base_url;
  if (context.baseUrl) {
    packet.base_url = context.baseUrl;
  }

  if (error) {
    packet.error_code = error.code;
    packet.error_message = sanitizeField(error.message);
    if (error.status != null) packet.error_status = error.status;
    if (error.fields != null && typeof error.fields === 'object') {
      assertNoForbiddenKeys(error.fields);
      const trustedFields = normalizeForgeErrorFields(error.code, error.fields);
      if (trustedFields != null) {
        Object.assign(packet, trustedFields);
      }
    }
  }

  return packet;
}

export function forgeErrorPacket(context, error, type = PACKET_TYPES.FORGE_ERROR) {
  const body = error?.fields != null && typeof error.fields === 'object' ? error.fields : {};
  return forgePacket(type, context, body, error);
}

export function unknownForgeContext() {
  return {
    providerId: 'unknown',
    remoteName: 'origin',
    repoId: 'unknown/unknown',
  };
}
