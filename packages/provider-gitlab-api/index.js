import {
  fetchJson,
  fetchJsonWithMeta,
  sanitizeField,
  sanitizeUrl,
  assertGitRef,
  assertGitRemote,
  gitRevParse,
  gitCurrentBranch,
  gitAheadBehind,
  refsInventory,
  crInventory,
  buildMergePlanFromProviderFacts,
  ERROR_CODES,
  forgeError,
  forgeIngestCapabilityFacts,
  checkPaginationCapabilityFacts,
  openPullListCapabilityFacts,
  DEFAULT_CHECK_STATUS_PAGE_SIZE,
  MAX_CHECK_STATUS_PAGES,
  DEFAULT_OPEN_PULL_LIST_PAGE_SIZE,
  paginateCheckStatusPages,
  paginateOffsetListPages,
  fetchWithIngestPageBackoff,
  fetchPageWithIngestBackoff,
  withPerPageParam,
  apiProviderCommands,
  normalizeCrInventorySort,
  DEFAULT_CR_INVENTORY_SLICE_SORT,
  parseTotalCountHeader,
  isCrInventoryFastPathEligible,
  validateFastPathPageLength,
  isNumberSortFastPathEligible,
  isNumberSortFullCollectRequired,
  resolveListTruncatedWithTrustedTotal,
  orderOpenPullNumbers,
  buildOpenPullListMeta,
  gitlabOpenPullSortQuery,
  appendSortQuery,
  buildProviderIdentityFromGitLabUser,
  buildBranchProtectionFromGitLabProtection,
  buildCrFilesFromGitLabChanges,
  buildCrCommentsBody,
  buildCrCommentsFromGitLabDiscussions,
  parseSinceObservedAt,
  buildForgeChangesFromGiteaPulls,
  buildChecksConclusionObservedEvent,
  appendForgeChangeEvents,
  parseStatusSetArgs,
  buildCommitStatusSetBody,
  normalizeStatusSetState,
  MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
  statusSetIdempotencyScanCapabilityFacts,
  assertWriteCommandConfigured,
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
  'status_set',
  'whoami',
];
const STRUCTURED_COMMANDS = apiProviderCommands({
  branchProtectionImplemented: true,
  crFilesImplemented: true,
  crCommentsImplemented: true,
  forgeChangesImplemented: true,
  statusSetImplemented: true,
});

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

export async function gitlabFetchWithMeta(config, parsed, path, options = {}) {
  const base = apiBase(config, parsed);
  const token = requireToken();
  const url = `${base}${path}`;
  return fetchJsonWithMeta(url, {
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
    write_support: true,
    write_commands: ['status_set'],
    ...forgeIngestCapabilityFacts(),
    ...statusSetIdempotencyScanCapabilityFacts(),
    ...checkPaginationCapabilityFacts({
      strategy: 'offset_limit',
      pageSizeParam: 'per_page',
      sourceCount: check_sources.length,
    }),
    ...openPullListCapabilityFacts({
      totalCountSource: 'response_header',
      totalCountHeader: 'X-Total',
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
  return buildMergePlanFromProviderFacts(ctx, opts, { prView, prChecks, crFiles });
}

export async function crFiles(ctx, { number }) {
  requireToken();
  if (number == null) {
    throw Object.assign(new Error('--number required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, 'Provide --number for MR changed paths'),
    });
  }
  const data = await gitlabFetch(
    ctx.config,
    ctx.parsed,
    projectApiPath(ctx.config, 'merge_requests', number, 'changes'),
  );
  return buildCrFilesFromGitLabChanges(number, data?.changes);
}

export async function crComments(ctx, { number }) {
  requireToken();
  if (number == null) {
    throw Object.assign(new Error('--number required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, 'Provide --number for MR review comments'),
    });
  }
  const path = projectApiPath(ctx.config, 'merge_requests', number, 'discussions');
  const pageSep = path.includes('?') ? '&' : '?';
  let activeLimit = DEFAULT_CHECK_STATUS_PAGE_SIZE;
  const allDiscussions = [];
  let listTruncated = false;
  let entryCount = 0;

  for (let page = 1; page <= MAX_CHECK_STATUS_PAGES; page += 1) {
    const { items, usedLimit } = await fetchPageWithIngestBackoff(
      async ({ page: pageNum, limit }) => {
        const body = await gitlabFetch(
          ctx.config,
          ctx.parsed,
          `${path}${pageSep}per_page=${limit}&page=${pageNum}`,
        );
        if (!Array.isArray(body)) {
          throw Object.assign(new Error('Provider returned non-array MR discussions list'), {
            forgeError: forgeError(
              ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT,
              'Provider returned non-array MR discussions list',
            ),
          });
        }
        return body;
      },
      page,
      activeLimit,
    );
    activeLimit = usedLimit;
    for (const discussion of items) {
      const notes = Array.isArray(discussion?.notes) ? discussion.notes : [];
      for (const note of notes) {
        if (note?.system === true) continue;
        entryCount += 1;
      }
    }
    allDiscussions.push(...items);
    if (items.length < usedLimit) break;
    if (page === MAX_CHECK_STATUS_PAGES) {
      listTruncated = true;
    }
  }

  const body = buildCrCommentsFromGitLabDiscussions(number, allDiscussions);
  if (listTruncated) {
    return buildCrCommentsBody({
      pr_number: body.pr_number,
      comments: body.comments,
      comments_truncated: true,
      comment_count: entryCount,
    });
  }
  return body;
}

function gitlabMergeRequestAsPull(mr) {
  if (mr == null || mr.iid == null) return null;
  let state = 'unknown';
  if (mr.state === 'opened') state = 'open';
  else if (mr.state === 'merged' || mr.state === 'closed') state = 'closed';
  return {
    number: mr.iid,
    title: mr.title,
    html_url: mr.web_url,
    state,
    created_at: mr.created_at,
    updated_at: mr.updated_at,
    closed_at: mr.closed_at,
    merged_at: mr.merged_at,
    head: { sha: mr.sha ?? mr.diff_refs?.head_sha ?? null },
  };
}

export async function forgeChanges(ctx, { since }) {
  requireToken();
  const sinceIso = parseSinceObservedAt(since);
  const path = `${projectApiPath(ctx.config, 'merge_requests')}?state=all&order_by=updated_at&sort=desc`;
  const pageSep = '&';
  let activeLimit = DEFAULT_CHECK_STATUS_PAGE_SIZE;
  const allMrs = [];
  let listTruncated = false;

  for (let page = 1; page <= MAX_CHECK_STATUS_PAGES; page += 1) {
    const { items, usedLimit } = await fetchPageWithIngestBackoff(
      async ({ page: pageNum, limit }) => {
        const body = await gitlabFetch(
          ctx.config,
          ctx.parsed,
          `${path}${pageSep}per_page=${limit}&page=${pageNum}`,
        );
        if (!Array.isArray(body)) {
          throw Object.assign(new Error('Provider returned non-array merge request list'), {
            forgeError: forgeError(
              ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT,
              'Provider returned non-array merge request list',
            ),
          });
        }
        return body;
      },
      page,
      activeLimit,
    );
    activeLimit = usedLimit;
    allMrs.push(...items);
    if (items.length < usedLimit) break;
    if (page === MAX_CHECK_STATUS_PAGES) {
      listTruncated = true;
    }
  }

  const pulls = allMrs.map(gitlabMergeRequestAsPull).filter(Boolean);
  let body = buildForgeChangesFromGiteaPulls(sinceIso, pulls, { listTruncated });
  const checkNumbers = new Set();
  for (const event of body.events) {
    if (event.kind === 'pr_opened' || event.kind === 'head_sha_moved') {
      checkNumbers.add(event.pr_number);
    }
  }

  const checkEvents = [];
  for (const number of checkNumbers) {
    const checks = await prChecks(ctx, { number });
    checkEvents.push(buildChecksConclusionObservedEvent(number, checks));
  }

  if (checkEvents.length > 0) {
    body = appendForgeChangeEvents(body, checkEvents, { listTruncated });
  }

  return body;
}

const GITLAB_OPEN_PULL_COMPLIANT_MAX =
  DEFAULT_OPEN_PULL_LIST_PAGE_SIZE * MAX_CHECK_STATUS_PAGES;

async function probeGitlabOpenPullPageOne(ctx, retainMax, sliceSort) {
  const maxTrusted = GITLAB_OPEN_PULL_COMPLIANT_MAX * 2;
  let path = `${projectApiPath(ctx.config, 'merge_requests')}?state=opened`;
  path = appendSortQuery(path, gitlabOpenPullSortQuery(sliceSort));
  const separator = path.includes('?') ? '&' : '?';
  const requestLimit = Math.min(retainMax, GITLAB_PAGE_SIZE);
  try {
    const { body, headers } = await gitlabFetchWithMeta(
      ctx.config,
      ctx.parsed,
      `${path}${separator}per_page=${requestLimit}&page=1`,
    );
    if (!Array.isArray(body)) return null;
    const totalCount = parseTotalCountHeader(headers, 'X-Total', { maxTrusted });
    if (totalCount == null) return null;
    const listTruncated = totalCount > GITLAB_OPEN_PULL_COMPLIANT_MAX;
    return { body, totalCount, listTruncated, requestLimit };
  } catch {
    return null;
  }
}

function buildGitlabOpenPullMetaFromPage(body, retainMax, sliceSort, totalCount, listTruncated) {
  let numbers = orderOpenPullNumbers(body, (mr) => mr?.iid, sliceSort);
  if (numbers.length > retainMax) numbers = numbers.slice(0, retainMax);
  return buildOpenPullListMeta({
    totalCount,
    numbers,
    listTruncated,
    sliceSort,
  });
}

function gitlabProbePaginationOpts(probe, extra = {}) {
  const { body, totalCount, requestLimit } = probe;
  return {
    trustedTotalCount: totalCount,
    seededFirstPage: { items: body, usedLimit: requestLimit },
    ...extra,
  };
}

async function paginateGitlabOpenPullList(ctx, opts, sliceSort, paginationOpts = {}) {
  const {
    trustedTotalCount = null,
    numberSortFullCollect = false,
    seededFirstPage = null,
    startPage = 1,
    maxPages = MAX_CHECK_STATUS_PAGES,
    suppressFinalPageProbe = false,
  } = paginationOpts;
  const listLimit =
    opts.limit != null && Number.isInteger(Number(opts.limit)) && Number(opts.limit) > 0
      ? Number(opts.limit)
      : null;
  const retainMax =
    listLimit == null &&
    opts.retain_max != null &&
    Number.isInteger(Number(opts.retain_max)) &&
    Number(opts.retain_max) > 0
      ? Number(opts.retain_max)
      : null;
  let path = `${projectApiPath(ctx.config, 'merge_requests')}?state=opened`;
  path = appendSortQuery(path, gitlabOpenPullSortQuery(sliceSort));
  const separator = path.includes('?') ? '&' : '?';
  const effectiveRetainMax = numberSortFullCollect ? null : retainMax;
  const {
    items: all,
    list_truncated: listTruncated,
    entry_count: entryCount,
    walked_count: walkedCount,
  } = await paginateOffsetListPages({
    pageSize: GITLAB_PAGE_SIZE,
    listLimit,
    retainMax: effectiveRetainMax,
    trustedEntryCount: trustedTotalCount,
    seededFirstPage,
    startPage,
    maxPages,
    suppressFinalPageProbe,
    ...(listLimit != null ? { maxPagesTruncatesWithLimit: true } : {}),
    fetchPage: async ({ page, limit }) => {
        const body = await gitlabFetch(
          ctx.config,
          ctx.parsed,
          `${path}${separator}per_page=${limit}&page=${page}`,
        );
        return Array.isArray(body) ? body : [];
      },
    });
  let numbers = orderOpenPullNumbers(all, (mr) => mr?.iid, sliceSort);
  const outputCap = listLimit ?? retainMax;
  if (outputCap != null && numbers.length > outputCap) {
    numbers = numbers.slice(0, outputCap);
  }
  return {
    numbers,
    list_truncated: resolveListTruncatedWithTrustedTotal({
      listTruncated,
      trustedTotalCount,
      walkedCount,
      fullCollect: numberSortFullCollect,
    }),
    ...(entryCount != null ? { entry_count: entryCount } : {}),
    slice_sort: sliceSort,
  };
}

export async function listOpenPullsWithMeta(ctx, opts = {}) {
  apiBase(ctx.config, ctx.parsed);
  requireToken();
  const sliceSort = normalizeCrInventorySort(opts.sort ?? DEFAULT_CR_INVENTORY_SLICE_SORT);
  if (!isCrInventoryFastPathEligible(opts)) {
    return paginateGitlabOpenPullList(ctx, opts, sliceSort);
  }

  const retainMax = Number(opts.retain_max);
  const probe = await probeGitlabOpenPullPageOne(ctx, retainMax, sliceSort);
  if (!probe) {
    return paginateGitlabOpenPullList(ctx, opts, sliceSort);
  }

  const { body, totalCount, listTruncated, requestLimit } = probe;

  if (listTruncated) {
    if (body.length === 0) {
      return paginateGitlabOpenPullList(ctx, opts, sliceSort, gitlabProbePaginationOpts(probe));
    }
    return buildGitlabOpenPullMetaFromPage(body, retainMax, sliceSort, totalCount, true);
  }

  if (
    isNumberSortFastPathEligible(totalCount, retainMax, sliceSort) &&
    validateFastPathPageLength(totalCount, requestLimit, body.length)
  ) {
    return buildGitlabOpenPullMetaFromPage(body, retainMax, sliceSort, totalCount, false);
  }

  const numberSortFullCollect = isNumberSortFullCollectRequired(totalCount, retainMax, sliceSort);
  return paginateGitlabOpenPullList(
    ctx,
    opts,
    sliceSort,
    gitlabProbePaginationOpts(probe, { numberSortFullCollect }),
  );
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

async function fetchGitLabPatSelf(ctx) {
  try {
    return await gitlabFetch(ctx.config, ctx.parsed, '/personal_access_tokens/self');
  } catch {
    return null;
  }
}

export async function whoami(ctx) {
  requireToken();
  const user = await gitlabFetch(ctx.config, ctx.parsed, '/user');
  const patSelf = await fetchGitLabPatSelf(ctx);
  return buildProviderIdentityFromGitLabUser(user, patSelf);
}

function approvalRulesForBranch(rules, branchRef) {
  if (!Array.isArray(rules)) return [];
  return rules.filter((rule) => {
    const branches = rule?.protected_branches;
    if (!Array.isArray(branches)) return false;
    return branches.some((branch) => branch?.name === branchRef);
  });
}

export async function branchProtection(ctx, { branchRef }) {
  assertGitRef(branchRef, '--branch-ref');
  requireToken();
  let protectedBranch = null;
  try {
    protectedBranch = await gitlabFetch(
      ctx.config,
      ctx.parsed,
      projectApiPath(ctx.config, 'protected_branches', branchRef),
    );
  } catch (err) {
    if (err?.status !== 404) throw err;
  }
  let approvalRules = [];
  if (protectedBranch != null) {
    try {
      const allRules = await gitlabFetch(
        ctx.config,
        ctx.parsed,
        projectApiPath(ctx.config, 'approval_rules'),
      );
      approvalRules = approvalRulesForBranch(allRules, branchRef);
    } catch {
      approvalRules = [];
    }
  }
  return buildBranchProtectionFromGitLabProtection(branchRef, { protectedBranch, approvalRules });
}

function gitlabStatusRecordOrder(a, b) {
  const aUpdated = Date.parse(a.updated_at ?? a.created_at ?? '') || 0;
  const bUpdated = Date.parse(b.updated_at ?? b.created_at ?? '') || 0;
  if (aUpdated !== bUpdated) return aUpdated - bUpdated;
  const aId = Number(a.id) || 0;
  const bId = Number(b.id) || 0;
  return aId - bId;
}

function gitlabStatusAsRemogramState(status) {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'failed' || normalized === 'canceled') return 'failure';
  if (
    normalized === 'running'
    || normalized === 'created'
    || normalized === 'waiting_for_resource'
    || normalized === 'preparing'
  ) {
    return 'pending';
  }
  return normalizeStatusSetState(normalized);
}

function remogramStateToGitlabPostState(state) {
  if (state === 'failure' || state === 'error') return 'failed';
  return state;
}

function statusSetIdempotencyScanIncompleteError(pagesScanned, pageSizeUsed) {
  return forgeError(
    ERROR_CODES.IDEMPOTENCY_SCAN_INCOMPLETE,
    'Cannot prove no commit status exists for sha+context within scan limit; retry or set manually',
    null,
    {
      idempotency_scan: {
        pages: pagesScanned,
        max_pages: MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
        page_size: pageSizeUsed,
      },
    },
  );
}

/** Paginated commit-status scan for idempotent status set; fail-closed when scan cap prevents proof of absence. */
export async function findCommitStatusByContext(ctx, sha, context) {
  requireToken();
  const path = projectApiPath(ctx.config, 'repository', 'commits', sha, 'statuses');
  const pageSep = path.includes('?') ? '&' : '?';
  let activeLimit = DEFAULT_CHECK_STATUS_PAGE_SIZE;
  let bestMatch = null;

  for (let page = 1; page <= MAX_OPEN_PULL_IDEMPOTENCY_PAGES; page += 1) {
    const { items, usedLimit } = await fetchPageWithIngestBackoff(
      async ({ page: pageNum, limit }) => {
        const body = await gitlabFetch(
          ctx.config,
          ctx.parsed,
          `${path}${pageSep}per_page=${limit}&page=${pageNum}`,
        );
        if (!Array.isArray(body)) {
          throw Object.assign(new Error('Provider returned non-array commit status list'), {
            forgeError: forgeError(
              ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT,
              'Provider returned non-array commit status list',
            ),
          });
        }
        return body;
      },
      page,
      activeLimit,
    );
    activeLimit = usedLimit;

    for (const record of items) {
      if (record?.name !== context) continue;
      if (!bestMatch || gitlabStatusRecordOrder(record, bestMatch) > 0) {
        bestMatch = record;
      }
    }

    if (items.length < usedLimit) return bestMatch;
    if (page === MAX_OPEN_PULL_IDEMPOTENCY_PAGES) {
      throw Object.assign(new Error('Commit status idempotency scan incomplete'), {
        forgeError: statusSetIdempotencyScanIncompleteError(page, usedLimit),
      });
    }
  }
  return bestMatch;
}

export async function statusSet(ctx, args) {
  assertWriteCommandConfigured(ctx.config, 'status_set');
  const parsed = parseStatusSetArgs(args);
  const existing = await findCommitStatusByContext(ctx, parsed.sha, parsed.context);
  if (existing) {
    const requestedGitlabState = remogramStateToGitlabPostState(parsed.state);
    const existingGitlabState = String(existing.status ?? existing.state ?? '').toLowerCase();
    if (existingGitlabState === requestedGitlabState) {
      const remogramState = gitlabStatusAsRemogramState(existing.status ?? existing.state);
      return buildCommitStatusSetBody(
        { ...existing, status: remogramState },
        parsed,
        { reusedExisting: true },
      );
    }
  }
  const payload = {
    state: remogramStateToGitlabPostState(parsed.state),
    name: parsed.context,
  };
  if (parsed.description != null) payload.description = parsed.description;
  if (parsed.target_url != null) payload.target_url = parsed.target_url;
  const response = await gitlabFetch(
    ctx.config,
    ctx.parsed,
    projectApiPath(ctx.config, 'statuses', parsed.sha),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  return buildCommitStatusSetBody(
    {
      ...response,
      status: gitlabStatusAsRemogramState(response?.status ?? response?.state ?? parsed.state),
    },
    parsed,
  );
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
  whoami,
  branchProtection,
  crFiles,
  crComments,
  forgeChanges,
  statusSet,
};
