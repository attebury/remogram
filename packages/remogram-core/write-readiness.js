import { AUTH_CLASS, API_PROVIDER_COMMAND_AUTH } from './auth-classes.js';
import {
  isWriteCommandAllowed,
  writeSourceForCommand,
  buildOperatorConfigSnippet,
  buildRepoConfigSnippet,
  normalizeWritePolicyInput,
} from './effective-write-policy.js';

const WRITE_ID_TO_AUTH_COMMAND = Object.freeze({
  merge: 'merge_execute',
});

function authCommandForWriteId(commandId) {
  return WRITE_ID_TO_AUTH_COMMAND[commandId] ?? commandId;
}

function commandNeedsToken(commandId) {
  return API_PROVIDER_COMMAND_AUTH[authCommandForWriteId(commandId)] === AUTH_CLASS.TOKEN_REQUIRED;
}

function providerImplementsWrite(commandId, providerCapabilities) {
  const authCommand = authCommandForWriteId(commandId);
  const command = providerCapabilities?.commands?.find(
    (entry) => entry.name === commandId || entry.name === authCommand,
  );
  if (command) return command.implemented !== false;
  return (providerCapabilities?.write_commands || []).includes(commandId);
}

/**
 * @param {object} configOrPolicy repo config or resolved write policy
 * @param {object | null} providerCapabilities
 * @param {{ authPresent?: boolean }} [opts]
 */
export function buildWriteReadiness(configOrPolicy, providerCapabilities, opts = {}) {
  const authPresent = opts.authPresent === true;
  const policy = normalizeWritePolicyInput(configOrPolicy);
  const providerWrites = [...new Set((providerCapabilities?.write_commands || []).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
  const repoWrites = policy.repoWriteCommands ?? [];
  const operatorWrites = policy.operatorWriteCommands ?? [];
  const commandIds = [...new Set([...providerWrites, ...repoWrites, ...operatorWrites])].sort((a, b) =>
    a.localeCompare(b),
  );

  const commands = commandIds.map((id) => {
    const provider_supported = providerWrites.includes(id) && providerImplementsWrite(id, providerCapabilities);
    const repo_configured = repoWrites.includes(id);
    const operator_configured = operatorWrites.includes(id);
    const configured = repo_configured || operator_configured;
    const source = writeSourceForCommand(repo_configured, operator_configured);
    const auth_present = commandNeedsToken(id) ? authPresent : true;
    const ready = provider_supported && configured && auth_present && !policy.operatorError;
    const entry = {
      id,
      provider_supported,
      configured,
      repo_configured,
      operator_configured,
      source,
      auth_present,
      ready,
    };
    if (provider_supported && !configured) {
      entry.next_config_snippet = buildRepoConfigSnippet(id, repoWrites);
      entry.next_operator_config_snippet = buildOperatorConfigSnippet(id, operatorWrites);
    }
    return entry;
  });

  return {
    configured_write_commands: policy.effectiveWriteCommands ?? [],
    repo_write_commands: repoWrites,
    operator_write_commands: operatorWrites,
    operator_config: policy.operatorMeta ?? null,
    operator_error: policy.operatorError ?? null,
    provider_write_commands: providerWrites,
    commands,
  };
}

/** True when any provider-supported write is not ready (config or auth). */
export function writeReadinessHasWarnings(writeConfig) {
  if (!writeConfig?.commands?.length) return false;
  if (writeConfig.operator_error) return true;
  return writeConfig.commands.some(
    (entry) => entry.provider_supported === true && entry.ready !== true,
  );
}
