import { ERROR_CODES, forgeError } from './contracts/errors.js';
import { assertCommitSha } from './status-set.js';
import { sanitizeField, sanitizeUrl } from './caps.js';

export function parseVerifyBindArgs({ target_sha, verifier, proof_url, note }) {
  if (target_sha == null || String(target_sha).trim() === '') {
    throw Object.assign(new Error('--target-sha required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--target-sha required for verify bind'),
    });
  }
  const parsed = {
    target_sha: assertCommitSha(target_sha, '--target-sha'),
  };
  if (verifier != null && String(verifier).trim() !== '') {
    parsed.verifier = sanitizeField(verifier);
  }
  if (proof_url != null && String(proof_url).trim() !== '') {
    parsed.proof_url = sanitizeUrl(String(proof_url));
  }
  if (note != null && String(note).trim() !== '') {
    parsed.note = sanitizeField(String(note));
  }
  return parsed;
}

export function buildVerifyBindBody(args) {
  return {
    ...args,
    bound: true,
  };
}
