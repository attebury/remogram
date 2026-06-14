import { ERROR_CODES, forgeError } from './contracts/errors.js';

/** v1 consumer-opt-in write commands (must match config-schema write_commands enum). */
export const CONFIGURED_WRITE_COMMANDS = Object.freeze(['cr_open']);

export function isWriteCommandConfigured(config, commandName) {
  const allowed = config?.write_commands;
  return Array.isArray(allowed) && allowed.includes(commandName);
}

export function assertWriteCommandConfigured(config, commandName) {
  if (isWriteCommandConfigured(config, commandName)) return;
  throw Object.assign(new Error(`Write command not configured: ${commandName}`), {
    forgeError: forgeError(
      ERROR_CODES.WRITE_NOT_CONFIGURED,
      `Add "${commandName}" to write_commands in .remogram.json to enable this command`,
    ),
  });
}
