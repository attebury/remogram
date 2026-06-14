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
const PUBLIC_GITEA_HOST = 'gitea.com';
const PUBLIC_GITEA_API = 'https://gitea.com/api/v1';
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

function configuredHost(config) {
  if (!config.baseUrl) return null;
  try {
    return new URL(config.baseUrl).host;
  } catch {
    throw Object.assign(new Error('Invalid baseUrl for gitea-api'), {
      forgeError: forgeError(ERROR_CODES.CONFIG_INVALID, 'Invalid baseUrl for gitea-api provider'),
    });
  }
}

function configOrigin(config) {
  if (!config.baseUrl) return null;
  try {
    return new URL(config.baseUrl).origin;
  } catch {
    throw Object.assign(new Error('Invalid baseUrl for gitea-api'), {
      forgeError: forgeError(ERROR_CODES.CONFIG_INVALID, 'Invalid baseUrl for gitea-api provider'),
    });
  }
}

export function apiBase(config, parsed = {}) {
  const remoteHost = parsed.host || configuredHost(config);
  if (!remoteHost) {
    throw Object.assign(new Error('remote host required for gitea-api'), {
      forgeError: forgeError(ERROR_CODES.CONFIG_INVALID, 'remote host required for gitea-api provider'),
    });
  }

  const host = remoteHost.toLowerCase();
  const configured = configuredHost(config);
  if (host === PUBLIC_GITEA_HOST) {
    if (configured && configured.toLowerCase() !== PUBLIC_GITEA_HOST) {
      const message = 'gitea.com remotes may use only https://gitea.com for API requests';
      throw Object.assign(new Error(message), {
        forgeError: forgeError(ERROR_CODES.UNTRUSTED_BASE_URL, message),
      });
    }
    return PUBLIC_GITEA_API;
  }

  if (!configured) {
    throw Object.assign(new Error('baseUrl required for gitea-api'), {
      forgeError: forgeError(ERROR_CODES.CONFIG_INVALID, 'baseUrl required for gitea-api provider'),
    });
  }

  if (configured.toLowerCase() !== host) {
    const message = `Gitea API host must match remote host ${remoteHost}`;
    throw Object.assign(new Error(message), {
      forgeError: forgeError(ERROR_CODES.UNTRUSTED_BASE_URL, message),
    });
  }

  const origin = configOrigin(config) || `https://${remoteHost}`;
  return `${origin.replace(/\/$/, '')}/api/v1`;
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

export async function giteaFetch(config, parsed, path, options = {}) {
  const token = requireToken();
  const url = `${apiBase(config, parsed)}${path}`;
  return fetchJson(url, {
    ...options,
    headers: { ...authHeaders(token), ...(options.headers || {}) },
  });
}

const MAX_CHECK_PAGES = MAX_CHECK_STATUS_PAGES;
const GITEA_PAGE_SIZE = 100;

export async function giteaFetchPaginated(config, parsed, path) {
  return paginateCheckStatusPages({
    fetchPage: async ({ page, limit }) => {
      const separator = path.includes('?') ? '&' : '?';
      const body = await giteaFetch(
        config,
        parsed,
        `${path}${separator}limit=${limit}&page=${page}`,
      );
      return Array.isArray(body) ? body : [];
    },
  });
}

export function normalizeGiteaStatusState(state) {
  const normalized = String(state ?? '').toLowerCase();
  if (normalized === 'success' || normalized === 'pass') return 'success';
  if (normalized === 'pending' || normalized === 'running' || normalized === 'waiting') {
    return 'pending';
  }
  if (normalized === 'failure' || normalized === 'fail' || normalized === 'error') {
    return 'failure';
  }
  return 'unknown';
}

export function normalizeGiteaPrState(state) {
  const normalized = String(state ?? '').toLowerCase();
  if (normalized === 'open') return 'open';
  if (normalized === 'closed') return 'closed';
  return normalized || 'unknown';
}

export async function repoStatus(ctx) {
  const token = giteaToken();
  let defaultBranch = null;
  if (token) {
    const repo = await giteaFetch(ctx.config, ctx.parsed, repoApiPath(ctx.config));
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
    host_binding: 'verified_remote_host',
    pagination: 'supported',
    write_support: false,
    ...forgeIngestCapabilityFacts(),
    ...checkPaginationCapabilityFacts({ strategy: 'offset_limit', pageSizeParam: 'limit' }),
  };
}

export async function refsCompare(ctx, baseRef, headRef) {
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
  return giteaFetch(ctx.config, ctx.parsed, repoApiPath(ctx.config, 'pulls', number));
}

export async function listOpenPullsWithMeta(ctx, opts = {}) {
  requireToken();
  const listLimit =
    opts.limit != null && Number.isInteger(Number(opts.limit)) && Number(opts.limit) > 0
      ? Number(opts.limit)
      : null;
  const pageSize =
    listLimit != null ? Math.min(listLimit, GITEA_PAGE_SIZE) : GITEA_PAGE_SIZE;
  const all = [];
  let listTruncated = false;
  const path = `${repoApiPath(ctx.config, 'pulls')}?state=open`;
  const pageSep = path.includes('?') ? '&' : '?';
  for (let page = 1; page <= MAX_CHECK_PAGES; page += 1) {
    const remaining = listLimit != null ? Math.max(listLimit - all.length, 0) : pageSize;
    if (listLimit != null && remaining === 0) break;
    const requestLimit = listLimit != null ? Math.min(pageSize, remaining) : pageSize;
    const body = await giteaFetch(
      ctx.config,
      ctx.parsed,
      `${path}${pageSep}limit=${requestLimit}&page=${page}`,
    );
    const items = Array.isArray(body) ? body : [];
    all.push(...items);
    if (items.length < requestLimit) break;
    if (listLimit != null) {
      if (all.length >= listLimit) {
        listTruncated = items.length >= requestLimit;
        break;
      }
    } else if (page === MAX_CHECK_PAGES) {
      listTruncated = true;
      break;
    }
  }
  let numbers = all
    .map((pr) => pr.number)
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
    state: normalizeGiteaPrState(pr.state),
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
  const statusRecords = await giteaFetchPaginated(
    ctx.config,
    ctx.parsed,
    repoApiPath(ctx.config, 'commits', sha, 'statuses'),
  );
  const mapped = statusRecords.map((s) => ({
    context: sanitizeField(s.context),
    state: normalizeGiteaStatusState(s.state),
    description: sanitizeField(s.description),
  }));
  const conclusion = summarizeChecks(mapped);
  return { head_sha: sha, check_conclusion: conclusion, statuses: mapped };
}

export function summarizeChecks(statuses) {
  if (!statuses.length) return 'missing';
  if (statuses.some((s) => s.state === 'failure' || s.state === 'error')) return 'failure';
  if (statuses.some((s) => s.state === 'pending')) return 'pending';
  if (statuses.every((s) => s.state === 'success')) return 'success';
  return 'unknown';
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
  refsInventory,
  listOpenPulls,
  crInventory: crInventorySlice,
  prView,
  prChecks,
  mergePlan,
  syncPlan,
};
