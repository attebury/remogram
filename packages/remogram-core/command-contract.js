import { PACKET_TYPES } from './contracts/envelope.js';
import { API_PROVIDER_COMMAND_AUTH } from './auth-classes.js';

export const COMMAND_REGISTRY = Object.freeze({
  'provider capabilities': {
    command: 'provider capabilities',
    packet_type: PACKET_TYPES.PROVIDER_CAPABILITIES,
    read_only: true,
    mcp_tool: 'provider_capabilities',
    auth_class: API_PROVIDER_COMMAND_AUTH.repo_status,
  },
  'repo status': {
    command: 'repo status',
    packet_type: PACKET_TYPES.REPO_STATUS,
    read_only: true,
    mcp_tool: 'repo_status',
    auth_class: API_PROVIDER_COMMAND_AUTH.repo_status,
  },
  'refs compare': {
    command: 'refs compare',
    packet_type: PACKET_TYPES.REF_COMPARE,
    read_only: true,
    mcp_tool: 'ref_compare',
    auth_class: API_PROVIDER_COMMAND_AUTH.ref_compare,
  },
  'refs inventory': {
    command: 'refs inventory',
    packet_type: 'ref_inventory',
    read_only: true,
    mcp_tool: 'ref_inventory',
    auth_class: API_PROVIDER_COMMAND_AUTH.ref_inventory,
  },
  'cr inventory': {
    command: 'cr inventory',
    packet_type: 'cr_inventory_slice',
    read_only: true,
    mcp_tool: 'cr_inventory',
    auth_class: API_PROVIDER_COMMAND_AUTH.cr_inventory,
  },
  'issue inventory': {
    command: 'issue inventory',
    packet_type: 'issue_inventory_slice',
    read_only: true,
    mcp_tool: 'issue_inventory',
    auth_class: API_PROVIDER_COMMAND_AUTH.issue_inventory,
  },
  'cr files': {
    command: 'cr files',
    packet_type: PACKET_TYPES.CR_FILES,
    read_only: true,
    mcp_tool: 'cr_files',
    auth_class: API_PROVIDER_COMMAND_AUTH.cr_files,
  },
  'cr comments': {
    command: 'cr comments',
    packet_type: PACKET_TYPES.CR_COMMENTS,
    read_only: true,
    mcp_tool: 'cr_comments',
    auth_class: API_PROVIDER_COMMAND_AUTH.cr_comments,
  },
  'issue comments': {
    command: 'issue comments',
    packet_type: PACKET_TYPES.ISSUE_COMMENTS,
    read_only: true,
    mcp_tool: 'issue_comments',
    auth_class: API_PROVIDER_COMMAND_AUTH.issue_comments,
  },
  'issue view': {
    command: 'issue view',
    packet_type: PACKET_TYPES.ISSUE_STATUS,
    read_only: true,
    mcp_tool: 'issue_view',
    auth_class: API_PROVIDER_COMMAND_AUTH.issue_status,
  },
  'pr view': {
    command: 'pr view',
    packet_type: PACKET_TYPES.PR_STATUS,
    read_only: true,
    mcp_tool: 'pr_status',
    auth_class: API_PROVIDER_COMMAND_AUTH.pr_status,
  },
  'pr checks': {
    command: 'pr checks',
    packet_type: PACKET_TYPES.PR_CHECKS,
    read_only: true,
    mcp_tool: 'pr_checks',
    auth_class: API_PROVIDER_COMMAND_AUTH.pr_checks,
  },
  'merge plan': {
    command: 'merge plan',
    packet_type: PACKET_TYPES.MERGE_PLAN,
    read_only: true,
    mcp_tool: 'merge_plan',
    auth_class: API_PROVIDER_COMMAND_AUTH.merge_plan,
  },
  'sync plan': {
    command: 'sync plan',
    packet_type: PACKET_TYPES.SYNC_PLAN,
    read_only: true,
    mcp_tool: 'sync_plan',
    auth_class: API_PROVIDER_COMMAND_AUTH.sync_plan,
  },
  whoami: {
    command: 'whoami',
    packet_type: PACKET_TYPES.PROVIDER_IDENTITY,
    read_only: true,
    mcp_tool: 'whoami',
    auth_class: API_PROVIDER_COMMAND_AUTH.whoami,
  },
  'branch protection': {
    command: 'branch protection',
    packet_type: PACKET_TYPES.BRANCH_PROTECTION,
    read_only: true,
    mcp_tool: 'branch_protection',
    auth_class: API_PROVIDER_COMMAND_AUTH.branch_protection,
  },
  'forge changes': {
    command: 'forge changes',
    packet_type: PACKET_TYPES.FORGE_CHANGES,
    read_only: true,
    mcp_tool: 'forge_changes',
    auth_class: API_PROVIDER_COMMAND_AUTH.forge_changes,
  },
  'cr open': {
    command: 'cr open',
    packet_type: PACKET_TYPES.CHANGE_REQUEST_OPENED,
    read_only: false,
    mcp_tool: 'cr_open',
    auth_class: API_PROVIDER_COMMAND_AUTH.cr_open,
  },
  'issue open': {
    command: 'issue open',
    packet_type: PACKET_TYPES.ISSUE_OPENED,
    read_only: false,
    mcp_tool: 'issue_open',
    auth_class: API_PROVIDER_COMMAND_AUTH.issue_open,
  },
  'status set': {
    command: 'status set',
    packet_type: PACKET_TYPES.COMMIT_STATUS_SET,
    read_only: false,
    mcp_tool: 'status_set',
    auth_class: API_PROVIDER_COMMAND_AUTH.status_set,
  },
  'merge execute': {
    command: 'merge execute',
    packet_type: PACKET_TYPES.CR_MERGED,
    read_only: false,
    mcp_tool: 'merge_execute',
    auth_class: API_PROVIDER_COMMAND_AUTH.merge_execute,
  },
  contract: {
    command: 'contract',
    packet_type: PACKET_TYPES.COMMAND_CONTRACT_EXPORT,
    read_only: true,
    mcp_tool: 'command_contract_export',
    auth_class: API_PROVIDER_COMMAND_AUTH.repo_status,
  },
  'verify bind': {
    command: 'verify bind',
    packet_type: PACKET_TYPES.VERIFY_BIND,
    read_only: true,
    mcp_tool: 'verify_bind',
    auth_class: API_PROVIDER_COMMAND_AUTH.pr_checks,
  },
  'review bundle': {
    command: 'review bundle',
    packet_type: PACKET_TYPES.REVIEW_BUNDLE,
    read_only: true,
    mcp_tool: 'review_bundle',
    auth_class: API_PROVIDER_COMMAND_AUTH.merge_plan,
  },
  'issue bundle': {
    command: 'issue bundle',
    packet_type: PACKET_TYPES.ISSUE_BUNDLE,
    read_only: true,
    mcp_tool: 'issue_bundle',
    auth_class: API_PROVIDER_COMMAND_AUTH.issue_status,
  },
});

export function normalizeCommandContractKey(command) {
  return String(command ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function buildCommandContractBody(command) {
  const key = normalizeCommandContractKey(command);
  if (!key) {
    return { commands: Object.values(COMMAND_REGISTRY) };
  }
  const entry = COMMAND_REGISTRY[key] ?? null;
  return {
    command: key,
    found: entry != null,
    ...(entry ? { contract: entry } : {}),
  };
}
