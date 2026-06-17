import { ERROR_CODES, forgeError } from './contracts/errors.js';

const GIT_REF_RE = /^[A-Za-z0-9._/+-]+$/;
const GIT_REMOTE_RE = /^[A-Za-z0-9._-]+$/;

function invalidArgs(message) {
  return Object.assign(new Error(message), {
    forgeError: forgeError(ERROR_CODES.INVALID_ARGS, message),
  });
}

export function assertGitRef(ref, label = 'ref') {
  if (typeof ref !== 'string' || !ref.trim()) {
    throw invalidArgs(`${label} is required`);
  }
  if (ref.startsWith('-')) {
    throw invalidArgs(`${label} must not start with '-'`);
  }
  if (ref.includes('..')) {
    throw invalidArgs(`${label} must not contain '..'`);
  }
  if (!GIT_REF_RE.test(ref)) {
    throw invalidArgs(`${label} contains invalid characters`);
  }
}

export function assertGitRemote(name, label = 'remote') {
  if (typeof name !== 'string' || !name.trim()) {
    throw invalidArgs(`${label} is required`);
  }
  if (name.startsWith('-')) {
    throw invalidArgs(`${label} must not start with '-'`);
  }
  if (!GIT_REMOTE_RE.test(name)) {
    throw invalidArgs(`${label} contains invalid characters`);
  }
}
