import { WRITE_COMMAND_IDS } from './write-config.js';

function uniqueSorted(list) {
  return [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function writeSourceForCommand(repoConfigured, operatorConfigured) {
  if (repoConfigured && operatorConfigured) return 'both';
  if (repoConfigured) return 'repo';
  if (operatorConfigured) return 'operator';
  return 'none';
}

/**
 * @param {object} repoConfig
 * @param {{ config?: object | null, meta?: object, error?: object | null }} operatorLoad
 */
export function resolveEffectiveWritePolicy(repoConfig, operatorLoad = {}) {
  const repoWriteCommands = uniqueSorted(
    Array.isArray(repoConfig?.write_commands) ? repoConfig.write_commands : [],
  );
  const operatorWriteCommands =
    operatorLoad.error || !operatorLoad.config
      ? []
      : uniqueSorted(operatorLoad.config.write_commands ?? []);
  const effectiveWriteCommands = uniqueSorted([...repoWriteCommands, ...operatorWriteCommands]);

  return {
    repoWriteCommands,
    operatorWriteCommands,
    effectiveWriteCommands,
    operatorMeta: operatorLoad.meta ?? { discovered_via: 'none', path: null, bind_ok: null },
    operatorError: operatorLoad.error ?? null,
  };
}

export function isWriteCommandAllowed(writePolicy, commandName) {
  if (!writePolicy || !commandName) return false;
  return writePolicy.effectiveWriteCommands.includes(commandName);
}

export function writePolicyFromLegacyConfig(config) {
  return resolveEffectiveWritePolicy(config, { config: null, meta: { discovered_via: 'none' }, error: null });
}

export function normalizeWritePolicyInput(input) {
  if (input && Array.isArray(input.effectiveWriteCommands)) {
    return input;
  }
  if (input?.writePolicy && Array.isArray(input.writePolicy.effectiveWriteCommands)) {
    return input.writePolicy;
  }
  return writePolicyFromLegacyConfig(input);
}

export function buildOperatorConfigSnippet(commandId, operatorWriteCommands = []) {
  const next = uniqueSorted([...operatorWriteCommands, commandId]);
  return `"write_commands": ${JSON.stringify(next)}`;
}

export function buildRepoConfigSnippet(commandId, repoWriteCommands = []) {
  const next = uniqueSorted([...repoWriteCommands, commandId]);
  return `"write_commands": ${JSON.stringify(next)}`;
}

export function allKnownWriteCommandIds() {
  return [...WRITE_COMMAND_IDS];
}
