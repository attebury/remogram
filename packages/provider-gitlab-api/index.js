import {
  fetchJson,
  sanitizeField,
  sanitizeUrl,
  assertGitRef,
  assertGitRemote,
  gitRevParse,
  gitCurrentBranch,
  gitAheadBehind,
  refsInventory,
  crInventory,
  mergeBlockersFromFacts,
  ERROR_CODES,
  forgeError,
  forgeIngestCapabilityFacts,
  checkPaginationCapabilityFacts,
  DEFAULT_CHECK_STATUS_PAGE_SIZE,
  MAX_CHECK_STATUS_PAGES,
  paginateCheckStatusPages,
  fetchWithIngestPageBackoff,
  withPerPageParam,
  apiProviderCommands,
} from '@remogram/core';

const PUBLIC_GITLAB_HOST = 'gitlab.com';
const PUBLIC_GITLAB_API = 'https://gitlab.com/api/v4';
const AUTH_CAPABILITIES = [
  'repo_status',
  'ref_compare',
  'ref_inventory',
  'cr_inventory',
  'pr_status',
  'pr_checks',
  'merge_plan',
  'sync_plan',
];
const STRUCTURED_COMMANDS = apiProviderCommands();

export function gitlabToken() {
  return process.env.GITLAB_TOKEN || null;
}

export function requireToken() {
  const token = gitlabToken();
  if (!token) {
    throw Object.assign(new Error('GITLAB_TOKEN not set'), {
      forgeError: forgeError(ERROR_CODES.UNAUTHENTICATED_PROVIDER, 'GITLAB_TOKEN not set'),
    });
  }
  return token;
}

function configuredHost(config) {
  if (!config.baseUrl) return null;
  try {
    return new URL(config.baseUrl).host;
  } catch {
    throw Object.assign(new Error('Invalid baseUrl for gitlab-api'), {
      forgeError: forgeError(ERROR_CODES.CONFIG_INVALID, 'Invalid baseUrl for gitlab-api provider'),
    });
  }
}

function configOrigin(config) {
  if (!config.baseUrl) return null;
  try {
    return new URL(config.baseUrl).origin;
  } catch {
    throw Object.assign(new Error('Invalid baseUrl for gitlab-api'), {
      forgeError: forgeError(ERROR_CODES.CONFIG_INVALID, 'Invalid baseUrl for gitlab-api provider'),
    });
  }
}

export function apiBase(config, parsed = {}) {
  const remoteHost = parsed.host || configuredHost(config);
  if (!remoteHost) {
    throw Object.assign(new Error('remote host required for gitlab-api'), {
      forgeError: forgeError(ERROR_CODES.CONFIG_INVALID, 'remote host required for gitlab-api provider'),
    });
  }

  const host = remoteHost.toLowerCase();
  const configured = configuredHost(config);
  if (host === PUBLIC_GITLAB_HOST) {
    if (configured && configured.toLowerCase() !== PUBLIC_GITLAB_HOST) {
      const message = 'gitlab.com remotes may use only https://gitlab.com/api/v4 for API requests';
      throw Object.assign(new Error(message), {
        forgeError: forgeError(ERROR_CODES.UNTRUSTED_BASE_URL, message),
      });
    }
    return PUBLIC_GITLAB_API;
  }

  if (configured && configured.toLowerCase() !== host) {
    const message = `GitLab API host must match remote host ${remoteHost}`;
    throw Object.assign(new Error(message), {
      forgeError: forgeError(ERROR_CODES.UNTRUSTED_BASE_URL, message),
    });
  }

  const origin = configOrigin(config) || `https://${remoteHost}`;
  return `${origin.replace(/\/$/, '')}/api/v4`;
}

export function authHeaders(token) {
  return { 'PRIVATE-TOKEN': token, Accept: 'application/json' };
}

export function projectId(config) {
  return encodeURIComponent(`${config.owner}/${config.repo}`);
}

export function projectApiPath(config, ...segments) {
  const base = `/projects/${projectId(config)}`;
  if (!segments.length) return base;
  return `${base}/${segments.map((s) => encodeURIComponent(String(s))).join('/')}`;
}

export async function gitlabFetch(config, parsed, path, options = {}) {
  const base = apiBase(config, parsed);
  const token = requireToken();
  const url = `${base}${path}`;
  return fetchJson(url, {
    ...options,
    headers: { ...authHeaders(token), ...(options.headers || {}) },
  });
}

const MAX_CHECK_PAGES = MAX_CHECK_STATUS_PAGES;
const GITLAB_PAGE_SIZE = 100;

export async function gitlabFetchPaginated(config, parsed, path) {
  return paginateCheckStatusPages({
    fetchPage: async ({ page, limit }) => {
      const separator = path.includes('?') ? '&' : '?';
      const body = await gitlabFetch(
        config,
        parsed,
        `${path}${separator}per_page=${limit}&page=${page}`,
      );
      return Array.isArray(body) ? body : [];
    },
  });
}

export function providerCapabilities() {
  const check_sources = ['commit_statuses', 'pipelines'];
  return {
    commands: STRUCTURED_COMMANDS,
    auth_envs: ['GITLAB_TOKEN'],
    check_sources,
    mergeability_confidence: 'derived',
    host_binding: 'verified_remote_host',
    pagination: 'supported',
    write_support: false,
    ...forgeIngestCapabilityFacts(),
    ...checkPaginationCapabilityFacts({
      strategy: 'offset_limit',
      pageSizeParam: 'per_page',
      sourceCount: check_sources.length,
    }),
  };
}

export async function repoStatus(ctx) {
  const token = gitlabToken();
  let defaultBranch = null;
  if (token) {
    const repo = await gitlabFetch(ctx.config, ctx.parsed, projectApiPath(ctx.config));
    defaultBranch = sanitizeField(repo.default_branch);
  }
  return {
    auth_present: Boolean(token),
    auth_env: token ? 'GITLAB_TOKEN' : null,
    capabilities: token ? AUTH_CAPABILITIES : ['repo_status'],
    default_branch: defaultBranch,
  };
}

export async function refsCompare(ctx, baseRef, headRef) {
  apiBase(ctx.config, ctx.parsed);
  assertGitRef(baseRef, 'base');
  assertGitRef(headRef, 'head');
  const baseSha = gitRevParse(ctx.cwd, baseRef);
  const headSha = gitRevParse(ctx.cwd, headRef);
  if (!baseSha || !headSha) {
    throw Object.assign(new Error('Missing ref'), {
      forgeError: forgeError(ERROR_CODES.MISSING_REF, 'Could not resolve base or head ref'),
    });
  }
  return {
    base_ref: sanitizeField(baseRef),
    base_sha: baseSha,
    head_ref: sanitizeField(headRef),
    head_sha: headSha,
    ...gitAheadBehind(ctx.cwd, baseSha, headSha),
  };
}

export async function getMergeRequest(ctx, { number }) {
  if (number == null) {
    throw Object.assign(new Error('--number required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, 'Provide --number for merge request lookup'),
    });
  }
  return gitlabFetch(ctx.config, ctx.parsed, projectApiPath(ctx.config, 'merge_requests', number));
}

function normalizeMrState(state) {
  if (state === 'opened') return 'open';
  return sanitizeField(state);
}

export function mergeability(mr) {
  const status = mr.detailed_merge_status || mr.merge_status;
  if (mr.has_conflicts === true || ['cannot_be_merged', 'conflict'].includes(status)) {
    return 'conflicted';
  }
  if (mr.has_conflicts === false && ['mergeable', 'can_be_merged'].includes(status)) {
    return 'clean';
  }
  return 'unknown';
}

export async function prView(ctx, opts) {
  const mr = await getMergeRequest(ctx, opts);
  return {
    pr_number: mr.iid,
    url: sanitizeUrl(mr.web_url ?? mr.url),
    title: sanitizeField(mr.title),
    state: normalizeMrState(mr.state),
    base_ref: sanitizeField(mr.target_branch),
    base_sha: sanitizeField(mr.diff_refs?.base_sha),
    head_ref: sanitizeField(mr.source_branch),
    head_sha: sanitizeField(mr.sha ?? mr.diff_refs?.head_sha),
    mergeability: mergeability(mr),
  };
}

function normalizeStatusState(state) {
  if (state === 'success' || state === 'skipped') return 'success';
  if (state === 'failed' || state === 'canceled') return 'failure';
  if (['created', 'pending', 'running', 'manual', 'scheduled'].includes(state)) return 'pending';
  return 'unknown';
}

export function summarizeChecks(statuses) {
  if (!statuses.length) return 'missing';
  if (statuses.some((s) => s.state === 'failure')) return 'failure';
  if (statuses.some((s) => s.state === 'pending')) return 'pending';
  if (statuses.every((s) => s.state === 'success')) return 'success';
  return 'unknown';
}

export async function prChecks(ctx, opts) {
  apiBase(ctx.config, ctx.parsed);
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
    const mr = await getMergeRequest(ctx, opts);
    sha = mr.sha ?? mr.diff_refs?.head_sha;
  }
  if (!sha) {
    throw Object.assign(new Error('No SHA'), {
      forgeError: forgeError(ERROR_CODES.MISSING_REF, 'Could not determine head SHA for checks'),
    });
  }

  const [statusResult, pipelineResult] = await Promise.all([
    gitlabFetchPaginated(
      ctx.config,
      ctx.parsed,
      projectApiPath(ctx.config, 'repository', 'commits', sha, 'statuses'),
    ),
    gitlabFetchPaginated(
      ctx.config,
      ctx.parsed,
      `${projectApiPath(ctx.config, 'pipelines')}?sha=${encodeURIComponent(sha)}`,
    ),
  ]);
  const statusRecords = statusResult.items;
  const pipelineRecords = pipelineResult.items;
  const mappedStatuses = statusRecords.map((status) => ({
    context: sanitizeField(status.name || status.context),
    state: normalizeStatusState(status.status),
    description: sanitizeField(status.description || status.status),
  }));
  const mappedPipelines = pipelineRecords.map((pipeline) => ({
    context: sanitizeField(pipeline.name || `pipeline:${pipeline.id}`),
    state: normalizeStatusState(pipeline.status),
    description: sanitizeField(pipeline.status),
  }));
  const mapped = [...mappedStatuses, ...mappedPipelines];
  const checks_truncated = statusResult.truncated || pipelineResult.truncated;
  return {
    head_sha: sha,
    check_conclusion: summarizeChecks(mapped),
    checks_truncated,
    statuses: mapped,
  };
}

export async function mergePlan(ctx, opts) {
  const view = await prView(ctx, opts);
  const checks = await prChecks(ctx, { number: view.pr_number });
  const blockers = mergeBlockersFromFacts(view, checks);
  return {
    pr_number: view.pr_number,
    mergeability: view.mergeability,
    checks_conclusion: checks.check_conclusion,
    blockers,
  };
}

export async function listOpenPullsWithMeta(ctx, opts = {}) {
  apiBase(ctx.config, ctx.parsed);
  requireToken();
  const listLimit =
    opts.limit != null && Number.isInteger(Number(opts.limit)) && Number(opts.limit) > 0
      ? Number(opts.limit)
      : null;
  const path = `${projectApiPath(ctx.config, 'merge_requests')}?state=opened`;
  const all = [];
  let listTruncated = false;
  for (let page = 1; page <= MAX_CHECK_PAGES; page += 1) {
    const remaining = listLimit != null ? Math.max(listLimit - all.length, 0) : GITLAB_PAGE_SIZE;
    if (listLimit != null && remaining === 0) break;
    const requestSize =
      listLimit != null ? Math.min(GITLAB_PAGE_SIZE, remaining) : GITLAB_PAGE_SIZE;
    const separator = path.includes('?') ? '&' : '?';
    const body = await gitlabFetch(
      ctx.config,
      ctx.parsed,
      `${path}${separator}per_page=${requestSize}&page=${page}`,
    );
    const items = Array.isArray(body) ? body : [];
    all.push(...items);
    if (items.length < requestSize) break;
    if (listLimit != null) {
      if (all.length >= listLimit) {
        listTruncated = items.length >= requestSize;
        break;
      }
    } else if (page === MAX_CHECK_PAGES) {
      listTruncated = true;
      break;
    }
  }
  let numbers = all
    .map((mr) => mr.iid)
    .filter((number) => Number.isInteger(number))
    .sort((a, b) => a - b);
  if (listLimit != null && numbers.length > listLimit) {
    numbers = numbers.slice(0, listLimit);
  }
  return { numbers, list_truncated: listTruncated };
}

export async function listOpenPulls(ctx, opts = {}) {
  const meta = await listOpenPullsWithMeta(ctx, opts);
  return meta.numbers;
}

export async function crInventorySlice(ctx, opts = {}) {
  return crInventory(ctx, { listOpenPulls, listOpenPullsWithMeta, prView, prChecks }, opts);
}

export async function syncPlan(ctx, remoteName = 'origin') {
  assertGitRemote(remoteName, 'remote');
  apiBase(ctx.config, ctx.parsed);
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
  id: 'gitlab-api',
  providerCapabilities,
  repoStatus,
  refsCompare,
  refsInventory,
  listOpenPulls,
  crInventory: crInventorySlice,
  prView,
  prChecks,
  mergePlan,
  syncPlan,
};
