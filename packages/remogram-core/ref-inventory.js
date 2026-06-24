import { execFileSync } from 'node:child_process';
import { sanitizeField } from './caps.js';
import { gitAheadBehind, gitCurrentBranch, gitRevParse } from './git-local.js';

const GIT_TIMEOUT_MS = 10_000;

function gitExec(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS }).trim();
}

function listRefs(cwd) {
  try {
    const out = gitExec(cwd, [
      'for-each-ref',
      '--format=%(refname:short)|%(objectname)|%(refname)',
      'refs/heads',
      'refs/remotes',
    ]);
    if (!out) return [];
    return out.split('\n').filter(Boolean).map((line) => {
      const [name, sha, fullRef] = line.split('|');
      const kind = fullRef.startsWith('refs/heads/') ? 'branch' : 'remote';
      return { name, sha, kind };
    });
  } catch {
    return [];
  }
}

function resolveDefaultRef(cwd, remoteName) {
  try {
    const sym = gitExec(cwd, ['symbolic-ref', `refs/remotes/${remoteName}/HEAD`]);
    const prefix = `refs/remotes/${remoteName}/`;
    if (sym.startsWith(prefix)) {
      return sym.slice(prefix.length);
    }
    return sym.replace(/^refs\/remotes\/[^/]+\//, '');
  } catch {
    return null;
  }
}

function buildAncestryHints(cwd, defaultRef, refs) {
  if (!defaultRef) return [];
  const defaultEntry = refs.find((r) => r.name === defaultRef || r.name === `origin/${defaultRef}`);
  const headBranch = gitCurrentBranch(cwd);
  if (!headBranch || headBranch === 'HEAD') return [];
  const headEntry = refs.find((r) => r.name === headBranch);
  if (!defaultEntry?.sha || !headEntry?.sha || defaultEntry.sha === headEntry.sha) return [];

  const counts = gitAheadBehind(cwd, defaultEntry.sha, headEntry.sha);
  if (counts.ahead_by == null && counts.behind_by == null) return [];

  return [
    {
      compare_base_ref: sanitizeField(defaultRef),
      compare_head_ref: sanitizeField(headBranch),
      ahead_by: counts.ahead_by,
      behind_by: counts.behind_by,
    },
  ];
}

/**
 * Build provider-neutral ref inventory body from local git.
 * @param {string} cwd repository working directory (git root after config load)
 * @param {string} [remoteName]
 */
export function buildRefInventoryBody(cwd, remoteName = 'origin') {
  const refs = listRefs(cwd).map((ref) => ({
    name: sanitizeField(ref.name),
    sha: ref.sha,
    kind: ref.kind,
    is_default: false,
  }));

  const defaultRef = resolveDefaultRef(cwd, remoteName);
  if (defaultRef) {
    for (const ref of refs) {
      if (ref.name === defaultRef || ref.name === `${remoteName}/${defaultRef}`) {
        ref.is_default = true;
      }
    }
  }

  const ancestry_hints = buildAncestryHints(cwd, defaultRef, refs);

  return {
    refs,
    ...(defaultRef ? { default_ref: sanitizeField(defaultRef) } : {}),
    ...(ancestry_hints.length > 0 ? { ancestry_hints } : {}),
  };
}

export async function refsInventory(ctx) {
  const remoteName = ctx.config.remote || 'origin';
  return buildRefInventoryBody(ctx.cwd, remoteName);
}
