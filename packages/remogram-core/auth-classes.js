/** Per-command auth requirements for structured provider capabilities. */
export const AUTH_CLASS = {
  NONE: 'none',
  GIT_ONLY: 'git_only',
  TOKEN_REQUIRED: 'token_required',
};

const AUTH_CLASS_VALUES = new Set(Object.values(AUTH_CLASS));

/** Runtime auth requirements for fully implemented API providers. */
export const API_PROVIDER_COMMAND_AUTH = {
  repo_status: AUTH_CLASS.NONE,
  ref_compare: AUTH_CLASS.GIT_ONLY,
  ref_inventory: AUTH_CLASS.GIT_ONLY,
  cr_inventory: AUTH_CLASS.TOKEN_REQUIRED,
  pr_status: AUTH_CLASS.TOKEN_REQUIRED,
  pr_checks: AUTH_CLASS.TOKEN_REQUIRED,
  merge_plan: AUTH_CLASS.TOKEN_REQUIRED,
  sync_plan: AUTH_CLASS.GIT_ONLY,
  cr_open: AUTH_CLASS.TOKEN_REQUIRED,
  issue_open: AUTH_CLASS.TOKEN_REQUIRED,
  status_set: AUTH_CLASS.TOKEN_REQUIRED,
  whoami: AUTH_CLASS.TOKEN_REQUIRED,
  branch_protection: AUTH_CLASS.TOKEN_REQUIRED,
  cr_files: AUTH_CLASS.TOKEN_REQUIRED,
  cr_comments: AUTH_CLASS.TOKEN_REQUIRED,
  issue_status: AUTH_CLASS.TOKEN_REQUIRED,
  issue_inventory: AUTH_CLASS.TOKEN_REQUIRED,
  issue_comments: AUTH_CLASS.TOKEN_REQUIRED,
  forge_changes: AUTH_CLASS.TOKEN_REQUIRED,
  merge_execute: AUTH_CLASS.TOKEN_REQUIRED,
};

export function commandCapability(name, { implemented = true } = {}) {
  const auth_class = API_PROVIDER_COMMAND_AUTH[name];
  if (!auth_class) {
    throw new Error(`Unknown command: ${name}`);
  }
  return { name, implemented, auth_class };
}

export function apiProviderCommands({
  writeCommandsImplemented = false,
  issueOpenImplemented = false,
  statusSetImplemented = false,
  branchProtectionImplemented = false,
  crFilesImplemented = false,
  crCommentsImplemented = false,
  issueReadImplemented = false,
  forgeChangesImplemented = false,
  mergeExecuteImplemented = false,
} = {}) {
  return Object.keys(API_PROVIDER_COMMAND_AUTH).map((name) => {
    let implemented = true;
    if (name === 'cr_open') implemented = writeCommandsImplemented;
    if (name === 'issue_open') implemented = issueOpenImplemented;
    if (name === 'status_set') implemented = statusSetImplemented;
    if (name === 'branch_protection') implemented = branchProtectionImplemented;
    if (name === 'cr_files') implemented = crFilesImplemented;
    if (name === 'cr_comments') implemented = crCommentsImplemented;
    if (name === 'issue_status' || name === 'issue_inventory' || name === 'issue_comments') {
      implemented = issueReadImplemented;
    }
    if (name === 'forge_changes') implemented = forgeChangesImplemented;
    if (name === 'merge_execute') implemented = mergeExecuteImplemented;
    return commandCapability(name, { implemented });
  });
}

export function stubProviderCommands() {
  return Object.keys(API_PROVIDER_COMMAND_AUTH).map((name) =>
    commandCapability(name, { implemented: false }),
  );
}

export function assertAuthClass(value) {
  if (!AUTH_CLASS_VALUES.has(value)) {
    throw new Error(`Invalid auth_class: ${value}`);
  }
}
