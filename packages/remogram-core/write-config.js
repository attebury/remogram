import { z } from 'zod';
import { ERROR_CODES, forgeError } from './contracts/errors.js';

/** Canonical v1 consumer write command ids (schema + gate single source). */
export const WRITE_COMMAND_IDS = Object.freeze(['cr_open']);

export const writeCommandSchema = z.enum(WRITE_COMMAND_IDS);

/** @deprecated use WRITE_COMMAND_IDS */
export const CONFIGURED_WRITE_COMMANDS = WRITE_COMMAND_IDS;

export function isWriteCommandConfigured(config, commandName) {
  if (!writeCommandSchema.safeParse(commandName).success) return false;
  const allowed = config?.write_commands;
  return Array.isArray(allowed) && allowed.includes(commandName);
}

export function assertWriteCommandConfigured(config, commandName) {
  if (!writeCommandSchema.safeParse(commandName).success) {
    throw Object.assign(new Error(`Unknown write command: ${commandName}`), {
      forgeError: forgeError(
        ERROR_CODES.INVALID_ARGS,
        `Unknown write command "${commandName}"; supported: ${WRITE_COMMAND_IDS.join(', ')}`,
      ),
    });
  }
  if (isWriteCommandConfigured(config, commandName)) return;
  throw Object.assign(new Error(`Write command not configured: ${commandName}`), {
    forgeError: forgeError(
      ERROR_CODES.WRITE_NOT_CONFIGURED,
      `Add "${commandName}" to write_commands in .remogram.json to enable this command`,
    ),
  });
}
