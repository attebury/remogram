import { z } from 'zod';
import { ERROR_CODES, forgeError } from './contracts/errors.js';
import {
  isWriteCommandAllowed,
  normalizeWritePolicyInput,
  buildOperatorConfigSnippet,
  buildRepoConfigSnippet,
} from './effective-write-policy.js';

/** Canonical v1 consumer write command ids (schema + gate single source). */
export const WRITE_COMMAND_IDS = Object.freeze(['cr_open', 'status_set', 'merge', 'issue_open']);

export const writeCommandSchema = z.enum(WRITE_COMMAND_IDS);

/** @deprecated use WRITE_COMMAND_IDS */
export const CONFIGURED_WRITE_COMMANDS = WRITE_COMMAND_IDS;

export function isWriteCommandConfigured(configOrPolicy, commandName) {
  if (!writeCommandSchema.safeParse(commandName).success) return false;
  const policy = normalizeWritePolicyInput(configOrPolicy);
  return isWriteCommandAllowed(policy, commandName);
}

/** Consumer-facing message when a write command is not opted in. */
export function writeNotConfiguredMessage(commandName) {
  return (
    `Command "${commandName}" is not in effective write_commands; add it to .remogram.json `
    + 'or a bound operator config (REMOGRAM_OPERATOR_CONFIG / --operator-config) '
    + 'for Remogram CLI/MCP writes, or use your forge/CI tooling outside Remogram '
    + '(read commands still work)'
  );
}

export function assertWriteCommandConfigured(configOrPolicy, commandName) {
  if (!writeCommandSchema.safeParse(commandName).success) {
    throw Object.assign(new Error(`Unknown write command: ${commandName}`), {
      forgeError: forgeError(
        ERROR_CODES.INVALID_ARGS,
        `Unknown write command "${commandName}"; supported: ${WRITE_COMMAND_IDS.join(', ')}`,
      ),
    });
  }
  const policy = normalizeWritePolicyInput(configOrPolicy);
  if (policy.operatorError) {
    const err = policy.operatorError;
    const message =
      err.fields?.reason === 'operator_bind_mismatch' && err.fields?.remediation
        ? err.message
        : err.message;
    throw Object.assign(new Error(message), {
      forgeError: err,
    });
  }
  if (isWriteCommandAllowed(policy, commandName)) return;
  throw Object.assign(new Error(`Write command not configured: ${commandName}`), {
    forgeError: forgeError(
      ERROR_CODES.WRITE_NOT_CONFIGURED,
      writeNotConfiguredMessage(commandName),
    ),
  });
}

export { buildOperatorConfigSnippet, buildRepoConfigSnippet };
