import { ERROR_CODES, forgeError } from '@remogram/core';

export const REPEATABLE_FLAGS = new Set(['allowed_path']);

export function parseAllowedPathFlags(flags) {
  if (flags.allowed_path == null) return undefined;
  return Array.isArray(flags.allowed_path) ? flags.allowed_path : [flags.allowed_path];
}

export function parsePositiveInt(value, name) {
  if (value == null) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw Object.assign(new Error(`Invalid ${name}`), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, `${name} must be a positive integer`),
    });
  }
  return n;
}

export function parseCliArgv(argv) {
  const positional = [];
  let asJson = false;
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') asJson = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-/g, '_');
      const next = argv[i + 1];
      if (REPEATABLE_FLAGS.has(key)) {
        if (!flags[key]) flags[key] = [];
        if (next != null && !next.startsWith('--')) {
          flags[key].push(next);
          i += 1;
        }
      } else if (next != null && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, asJson, flags };
}
