import { execFileSync } from 'node:child_process';
import {
  fetchJson,
  sanitizeField,
  sanitizeUrl,
  assertGitRef,
  assertGitRemote,
  ERROR_CODES,
  forgeError,
} from '@remogram/core';

const GIT_TIMEOUT_MS = 10_000;
const AUTH_CAPABILITIES = [
  'repo_status',
  'ref_compare',
  'pr_status',
  'pr_checks',
  'merge_plan',
  'sync_plan',
];

const STRUCTURED_COMMANDS = AUTH_CAPABILITIES.map((name) => ({ name, implemented: true }));

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

export function repoApiPath(config, ...segments) {
  const owner = encodeURIComponent(config.owner);
  const repo = encodeURIComponent(config.repo);
  const base = `/repos/${owner}/${repo}`;
  if (!segments.length) return base;
  return `${base}/${segments.map((s) => encodeURIComponent(String(s))).join('/')}`;
}

export async function giteaFetch(config, path, options = {}) {
  const token = requireToken();
  const url = `${apiBase(config)}${path}`;
  return fetchJson(url, {
    ...options,
    headers: { ...authHeaders(token), ...(options.headers || {}) },
  });
}

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
  try {
    const out = gitExec(cwd, ['rev-list', '--left-right', '--count', `${base}...${head}`]);
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
    const repo = await giteaFetch(ctx.config, repoApiPath(ctx.config));
    defaultBranch = sanitizeField(repo.default_branch);
  }
  return {
    auth_present: Boolean(token),
    auth_env: token ? 'GITEA_TOKEN' : null,
    capabilities: token ? AUTH_CAPABILITIES : ['repo_status'],
    default_branch: defaultBranch,
  };
}

export function providerCapabilities() {
  return {
    commands: STRUCTURED_COMMANDS,
    auth_envs: ['GITEA_TOKEN'],
    check_sources: ['commit_statuses'],
    mergeability_confidence: 'direct',
    host_binding: 'trusted_base_url',
    pagination: 'first_page_only',
    write_support: false,
  };
}

export async function refsCompare(ctx, baseRef, headRef) {
  requireToken();
  assertGitRef(baseRef, 'base');
  assertGitRef(headRef, 'head');
  const baseSha = gitRevParse(ctx.cwd, baseRef);
  const headSha = gitRevParse(ctx.cwd, headRef);
  if (!baseSha || !headSha) {
    throw Object.assign(new Error('Missing ref'), {
      forgeError: forgeError(ERROR_CODES.MISSING_REF, 'Could not resolve base or head ref'),
    });
  }
  const counts = gitAheadBehind(ctx.cwd, baseSha, headSha);
  return {
    base_ref: sanitizeField(baseRef),
    base_sha: baseSha,
    head_ref: sanitizeField(headRef),
    head_sha: headSha,
    ...counts,
  };
}

export async function getPull(ctx, { number }) {
  if (number == null) {
    throw Object.assign(new Error('--number required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, 'Provide --number for PR lookup'),
    });
  }
  return giteaFetch(ctx.config, repoApiPath(ctx.config, 'pulls', number));
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
    url: sanitizeUrl(pr.html_url ?? pr.url),
    title: sanitizeField(pr.title),
    state: sanitizeField(pr.state),
    base_ref: sanitizeField(pr.base?.ref),
    base_sha: sanitizeField(pr.base?.sha),
    head_ref: sanitizeField(pr.head?.ref),
    head_sha: sanitizeField(pr.head?.sha),
    mergeability: mergeability(pr),
  };
}

export async function prChecks(ctx, opts) {
  requireToken();
  let sha;
  if (opts.ref) {
    assertGitRef(opts.ref, 'ref');
    sha = gitRevParse(ctx.cwd, opts.ref);
    if (!sha) {
      throw Object.assign(new Error('Missing ref'), {
        forgeError: forgeError(ERROR_CODES.MISSING_REF, `Could not resolve ref ${opts.ref}`),
      });
    }
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
    repoApiPath(ctx.config, 'commits', sha, 'statuses'),
  );
  const mapped = (statuses || []).map((s) => ({
    context: sanitizeField(s.context),
    state: sanitizeField(s.state),
    description: sanitizeField(s.description),
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
  const checks = await prChecks(ctx, { number: view.pr_number });
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
  assertGitRemote(remoteName, 'remote');
  const localSha = gitRevParse(ctx.cwd, 'HEAD');
  const branch = gitCurrentBranch(ctx.cwd);
  let remoteSha = null;
  if (branch && branch !== 'HEAD') {
    remoteSha = gitRevParse(ctx.cwd, `${remoteName}/${branch}`);
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
    remote: sanitizeField(remoteName),
    local_sha: localSha,
    remote_sha: remoteSha,
    diverged,
    blockers,
  };
}

export const provider = {
  id: 'gitea-api',
  providerCapabilities,
  repoStatus,
  refsCompare,
  prView,
  prChecks,
  mergePlan,
  syncPlan,
};
