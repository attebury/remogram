import { execFileSync } from 'node:child_process';
import { fetchJson, ERROR_CODES, forgeError } from '@remogram/core';

export function giteaToken() {
  return process.env.GITEA_TOKEN || null;
}

export function requireToken() {
  const token = giteaToken();
  if (!token) {
    throw Object.assign(new Error('GITEA_TOKEN not set'), {
      forgeError: forgeError(ERROR_CODES.UNAUTHENTICATED_PROVIDER, 'GITEA_TOKEN not set'),
    });
  }
  return token;
}

export function apiBase(config) {
  if (!config.baseUrl) {
    throw Object.assign(new Error('baseUrl required for gitea-api'), {
      forgeError: forgeError(ERROR_CODES.CONFIG_INVALID, 'baseUrl required for gitea-api provider'),
    });
  }
  return `${config.baseUrl.replace(/\/$/, '')}/api/v1`;
}

export function authHeaders(token) {
  return { Authorization: `token ${token}`, Accept: 'application/json' };
}

export async function giteaFetch(config, path, options = {}) {
  const token = requireToken();
  const url = `${apiBase(config)}${path}`;
  return fetchJson(url, {
    ...options,
    headers: { ...authHeaders(token), ...(options.headers || {}) },
  });
}

export function gitRevParse(cwd, ref) {
  try {
    return execFileSync('git', ['rev-parse', ref], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function gitAheadBehind(cwd, base, head) {
  try {
    const out = execFileSync('git', ['rev-list', '--left-right', '--count', `${base}...${head}`], {
      cwd,
      encoding: 'utf8',
    }).trim();
    const [behind, ahead] = out.split(/\s+/).map(Number);
    return { ahead_by: ahead, behind_by: behind };
  } catch {
    return { ahead_by: null, behind_by: null };
  }
}

export async function repoStatus(ctx) {
  const token = giteaToken();
  let defaultBranch = null;
  if (token) {
    const repo = await giteaFetch(ctx.config, `/repos/${ctx.config.owner}/${ctx.config.repo}`);
    defaultBranch = repo.default_branch ?? null;
  }
  return {
    auth_present: Boolean(token),
    auth_env: token ? 'GITEA_TOKEN' : null,
    capabilities: [
      'repo_status',
      'ref_compare',
      'pr_status',
      'pr_checks',
      'merge_plan',
      'sync_plan',
    ],
    default_branch: defaultBranch,
  };
}

export async function refsCompare(ctx, baseRef, headRef) {
  const baseSha = gitRevParse(ctx.cwd, baseRef);
  const headSha = gitRevParse(ctx.cwd, headRef);
  if (!baseSha || !headSha) {
    throw Object.assign(new Error('Missing ref'), {
      forgeError: forgeError(ERROR_CODES.MISSING_REF, 'Could not resolve base or head ref'),
    });
  }
  const counts = gitAheadBehind(ctx.cwd, baseSha, headSha);
  return {
    base_ref: baseRef,
    base_sha: baseSha,
    head_ref: headRef,
    head_sha: headSha,
    ...counts,
  };
}

export async function getPull(ctx, { index, number }) {
  if (number != null) {
    return giteaFetch(ctx.config, `/repos/${ctx.config.owner}/${ctx.config.repo}/pulls/${number}`);
  }
  if (index != null) {
    const list = await giteaFetch(
      ctx.config,
      `/repos/${ctx.config.owner}/${ctx.config.repo}/pulls?state=all&limit=50`,
    );
    const pr = list[index - 1];
    if (!pr) {
      throw Object.assign(new Error('PR not found'), {
        forgeError: forgeError(ERROR_CODES.MISSING_REF, `No PR at index ${index}`),
      });
    }
    return pr;
  }
  throw Object.assign(new Error('index or number required'), {
    forgeError: forgeError(ERROR_CODES.INVALID_ARGS, 'Provide --index or --number'),
  });
}

function mergeability(pr) {
  if (pr.mergeable === true) return 'clean';
  if (pr.mergeable === false) return 'conflicted';
  return 'unknown';
}

export async function prView(ctx, opts) {
  const pr = await getPull(ctx, opts);
  return {
    pr_number: pr.number,
    pr_index: opts.index ?? null,
    url: pr.html_url ?? pr.url,
    title: pr.title,
    state: pr.state,
    base_ref: pr.base?.ref,
    base_sha: pr.base?.sha,
    head_ref: pr.head?.ref,
    head_sha: pr.head?.sha,
    mergeability: mergeability(pr),
  };
}

export async function prChecks(ctx, opts) {
  let sha;
  if (opts.ref) {
    sha = gitRevParse(ctx.cwd, opts.ref) || opts.ref;
  } else {
    const pr = await getPull(ctx, opts);
    sha = pr.head?.sha;
  }
  if (!sha) {
    throw Object.assign(new Error('No SHA'), {
      forgeError: forgeError(ERROR_CODES.MISSING_REF, 'Could not determine head SHA for checks'),
    });
  }
  const statuses = await giteaFetch(
    ctx.config,
    `/repos/${ctx.config.owner}/${ctx.config.repo}/commits/${sha}/statuses`,
  );
  const mapped = (statuses || []).map((s) => ({
    context: s.context,
    state: s.state,
    description: s.description,
  }));
  const conclusion = summarizeChecks(mapped);
  return { head_sha: sha, check_conclusion: conclusion, statuses: mapped };
}

function summarizeChecks(statuses) {
  if (!statuses.length) return 'missing';
  if (statuses.some((s) => s.state === 'failure' || s.state === 'error')) return 'failure';
  if (statuses.some((s) => s.state === 'pending')) return 'pending';
  if (statuses.every((s) => s.state === 'success')) return 'success';
  return 'unknown';
}

export async function mergePlan(ctx, opts) {
  const view = await prView(ctx, opts);
  const checks = await prChecks(ctx, { index: opts.index, number: view.pr_number });
  const blockers = [];
  if (view.mergeability === 'conflicted') blockers.push('merge_conflict');
  if (view.state !== 'open') blockers.push('pr_not_open');
  if (checks.check_conclusion === 'failure') blockers.push('checks_failed');
  if (checks.check_conclusion === 'missing') blockers.push('checks_missing');
  if (checks.check_conclusion === 'pending') blockers.push('checks_pending');
  return {
    pr_number: view.pr_number,
    mergeability: view.mergeability,
    checks_conclusion: checks.check_conclusion,
    blockers,
  };
}

export async function syncPlan(ctx, remoteName = 'origin') {
  const localSha = gitRevParse(ctx.cwd, 'HEAD');
  let remoteSha = null;
  try {
    execFileSync('git', ['fetch', remoteName, '--quiet'], { cwd: ctx.cwd, stdio: 'ignore' });
    remoteSha = gitRevParse(ctx.cwd, `${remoteName}/HEAD`) || gitRevParse(ctx.cwd, remoteName);
  } catch {
    /* fetch may fail offline in tests */
  }
  const blockers = [];
  let diverged = false;
  if (localSha && remoteSha && localSha !== remoteSha) {
    const { ahead_by, behind_by } = gitAheadBehind(ctx.cwd, remoteSha, localSha);
    if (ahead_by > 0 && behind_by > 0) {
      diverged = true;
      blockers.push('divergent_remotes');
    }
  }
  if (!remoteSha) blockers.push('missing_remote_ref');
  return {
    remote: remoteName,
    local_sha: localSha,
    remote_sha: remoteSha,
    diverged,
    blockers,
  };
}

export const provider = {
  id: 'gitea-api',
  repoStatus,
  refsCompare,
  prView,
  prChecks,
  mergePlan,
  syncPlan,
};
