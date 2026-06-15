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
};

export function commandCapability(name, { implemented = true } = {}) {
  const auth_class = API_PROVIDER_COMMAND_AUTH[name];
  if (!auth_class) {
    throw new Error(`Unknown command: ${name}`);
  }
  return { name, implemented, auth_class };
}

export function apiProviderCommands({ writeCommandsImplemented = false } = {}) {
  return Object.keys(API_PROVIDER_COMMAND_AUTH).map((name) => {
    const implemented = name === 'cr_open' ? writeCommandsImplemented : true;
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
