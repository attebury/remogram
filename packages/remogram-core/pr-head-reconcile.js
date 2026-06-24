import { assertGitRemote } from './git-args.js';
import { ERROR_CODES, forgeError } from './contracts/errors.js';
import { gitRevParse } from './git-local.js';

export const STALE_HEAD_MESSAGE =
  'Forge PR head SHA diverges from locally resolved git; fetch or refresh before trusting forge_source_sha';

export function localHeadShaForPr(cwd, remoteName, headRef) {
  if (!headRef) return null;
  assertGitRemote(remoteName, 'remote');
  const trackingRef = `${remoteName}/${headRef}`;
  return gitRevParse(cwd, trackingRef) ?? gitRevParse(cwd, headRef);
}

export function staleHeadDetails(cwd, remoteName, headRef, forgeHeadSha) {
  if (!headRef || !forgeHeadSha) return null;
  const localHeadSha = localHeadShaForPr(cwd, remoteName, headRef);
  if (!localHeadSha) return null;
  if (localHeadSha.toLowerCase() === String(forgeHeadSha).toLowerCase()) return null;
  return {
    forge_source_branch_ref: headRef,
    forge_source_sha: forgeHeadSha,
    local_head_sha: localHeadSha,
  };
}

export function staleHeadForgeError() {
  return forgeError(ERROR_CODES.STALE_HEAD, STALE_HEAD_MESSAGE);
}

export function throwIfStaleHeadByNumber(ctx, packetType, body, headRef, forgeHeadSha) {
  const details = staleHeadDetails(ctx.cwd, ctx.config?.remote ?? ctx.remoteName, headRef, forgeHeadSha);
  if (!details) return;
  const err = new Error(STALE_HEAD_MESSAGE);
  err.forgeError = staleHeadForgeError();
  err.staleHeadPacket = { type: packetType, body: { ...body, ...details } };
  throw err;
}
