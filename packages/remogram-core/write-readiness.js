import { isWriteCommandConfigured } from './write-config.js';
import { API_PROVIDER_COMMAND_AUTH, AUTH_CLASS } from './auth-classes.js';

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

function buildNextConfigSnippet(commandId, configuredWrites) {
  const next = [...new Set([...(configuredWrites || []), commandId])].sort((a, b) => a.localeCompare(b));
  return `"write_commands": ${JSON.stringify(next)}`;
}

/**
 * @param {object} config
 * @param {object | null} providerCapabilities
 * @param {{ authPresent?: boolean }} [opts]
 */
export function buildWriteReadiness(config, providerCapabilities, opts = {}) {
  const authPresent = opts.authPresent === true;
  const providerWrites = [...new Set((providerCapabilities?.write_commands || []).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
  const configuredWrites = [...new Set((Array.isArray(config?.write_commands) ? config.write_commands : []).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
  const commandIds = [...new Set([...providerWrites, ...configuredWrites])].sort((a, b) => a.localeCompare(b));

  const commands = commandIds.map((id) => {
    const provider_supported = providerWrites.includes(id) && providerImplementsWrite(id, providerCapabilities);
    const configured = isWriteCommandConfigured(config, id);
    const auth_present = commandNeedsToken(id) ? authPresent : true;
    const ready = provider_supported && configured && auth_present;
    const entry = {
      id,
      provider_supported,
      configured,
      auth_present,
      ready,
    };
    if (provider_supported && !configured) {
      entry.next_config_snippet = buildNextConfigSnippet(id, configuredWrites);
    }
    return entry;
  });

  return {
    configured_write_commands: configuredWrites,
    provider_write_commands: providerWrites,
    commands,
  };
}

/** True when any provider-supported write is not ready (config or auth). */
export function writeReadinessHasWarnings(writeConfig) {
  if (!writeConfig?.commands?.length) return false;
  return writeConfig.commands.some(
    (entry) => entry.provider_supported === true && entry.ready !== true,
  );
}
