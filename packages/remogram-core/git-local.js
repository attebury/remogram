import { execFileSync } from 'node:child_process';
import { assertGitRef } from './git-args.js';

const GIT_TIMEOUT_MS = 10_000;

function gitExec(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS }).trim();
}

export function gitRevParse(cwd, ref) {
  assertGitRef(ref);
  try {
    return gitExec(cwd, ['rev-parse', ref]);
  } catch {
    return null;
  }
}

export function gitCurrentBranch(cwd) {
  try {
    return gitExec(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {
    return null;
  }
}

export function gitAheadBehind(cwd, base, head) {
  assertGitRef(base, 'base');
  assertGitRef(head, 'head');
  try {
    const out = gitExec(cwd, ['rev-list', '--left-right', '--count', `${base}...${head}`]);
    const [behind, ahead] = out.split(/\s+/).map(Number);
    return { ahead_by: ahead, behind_by: behind };
  } catch {
    return { ahead_by: null, behind_by: null };
  }
}
