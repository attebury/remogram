import {
  fetchJson,
  fetchJsonWithMeta,
  parseLinkHeader,
  isTrustedPaginationUrl,
  sanitizeField,
  sanitizeUrl,
  assertGitRef,
  assertGitRemote,
  gitRevParse,
  gitCurrentBranch,
  gitAheadBehind,
  refsInventory,
  crInventory,
  buildMergePlanBodyFromFacts,
  ERROR_CODES,
  forgeError,
  forgeIngestCapabilityFacts,
  checkPaginationCapabilityFacts,
  openPullListCapabilityFacts,
  DEFAULT_CHECK_STATUS_PAGE_SIZE,
  MAX_CHECK_STATUS_PAGES,
  DEFAULT_OPEN_PULL_LIST_PAGE_SIZE,
  fetchWithIngestPageBackoff,
  paginateOffsetListPages,
  fetchPageWithIngestBackoff,
  withPerPageParam,
  apiProviderCommands,
  normalizeCrInventorySort,
  DEFAULT_CR_INVENTORY_SLICE_SORT,
  isCrInventoryFastPathEligible,
  validateFastPathPageLength,
  isNumberSortFastPathEligible,
  isNumberSortFullCollectRequired,
  resolvePaginatedEntryCount,
  resolveListTruncatedWithTrustedTotal,
  orderOpenPullNumbers,
  buildOpenPullListMeta,
  githubOpenPullSortQuery,
} from '@remogram/core';

const PUBLIC_GITHUB_HOST = 'github.com';
const PUBLIC_GITHUB_API = 'https://api.github.com';
const PUBLIC_GITHUB_GRAPHQL = 'https://api.github.com/graphql';

const PR_VIEW_QUERY = `
query RemogramPrView($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number
      url
      title
      state
      mergeable
      mergeStateStatus
      baseRefName
      baseRefOid
      headRefName
      headRefOid
    }
  }
}
`;
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

export function githubToken() {
  if (process.env.GITHUB_TOKEN) return { token: process.env.GITHUB_TOKEN, env: 'GITHUB_TOKEN' };
  if (process.env.GH_TOKEN) return { token: process.env.GH_TOKEN, env: 'GH_TOKEN' };
  return { token: null, env: null };
}

export function requireToken() {
  const auth = githubToken();
  if (!auth.token) {
    throw Object.assign(new Error('GITHUB_TOKEN or GH_TOKEN not set'), {
      forgeError: forgeError(
        ERROR_CODES.UNAUTHENTICATED_PROVIDER,
        'GITHUB_TOKEN or GH_TOKEN not set',
      ),
    });
  }
  return auth;
}

function configOrigin(config) {
  if (!config.baseUrl) return null;
  try {
    const url = new URL(config.baseUrl);
    return url.origin;
  } catch {
    throw Object.assign(new Error('Invalid baseUrl for github-api'), {
      forgeError: forgeError(ERROR_CODES.CONFIG_INVALID, 'Invalid baseUrl for github-api provider'),
    });
  }
}

function configuredHost(config) {
  if (!config.baseUrl) return null;
  try {
    return new URL(config.baseUrl).host;
  } catch {
    throw Object.assign(new Error('Invalid baseUrl for github-api'), {
      forgeError: forgeError(ERROR_CODES.CONFIG_INVALID, 'Invalid baseUrl for github-api provider'),
    });
  }
}

export function apiBase(config, parsed = {}) {
  const remoteHost = parsed.host || configuredHost(config);
  if (!remoteHost) {
    throw Object.assign(new Error('remote host required for github-api'), {
      forgeError: forgeError(ERROR_CODES.CONFIG_INVALID, 'remote host required for github-api provider'),
    });
  }

  const host = remoteHost.toLowerCase();
  const configured = configuredHost(config);
  if (host === PUBLIC_GITHUB_HOST) {
    if (configured && configured.toLowerCase() !== PUBLIC_GITHUB_HOST) {
      const message = 'github.com remotes may use only https://api.github.com for API requests';
      throw Object.assign(new Error(message), {
        forgeError: forgeError(
          ERROR_CODES.UNTRUSTED_BASE_URL,
          message,
        ),
      });
    }
    return PUBLIC_GITHUB_API;
  }

  if (configured && configured.toLowerCase() !== host) {
    const message = `GitHub Enterprise API host must match remote host ${remoteHost}`;
    throw Object.assign(new Error(message), {
      forgeError: forgeError(
        ERROR_CODES.UNTRUSTED_BASE_URL,
        message,
      ),
    });
  }

  const origin = configOrigin(config) || `https://${remoteHost}`;
  return `${origin.replace(/\/$/, '')}/api/v3`;
}

export function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function repoApiPath(config, ...segments) {
  const owner = encodeURIComponent(config.owner);
  const repo = encodeURIComponent(config.repo);
  const base = `/repos/${owner}/${repo}`;
  if (!segments.length) return base;
  return `${base}/${segments.map((s) => encodeURIComponent(String(s))).join('/')}`;
}

export async function githubFetch(config, parsed, path, options = {}) {
  const base = apiBase(config, parsed);
  const { token } = requireToken();
  const url = `${base}${path}`;
  return fetchJson(url, {
    ...options,
    headers: { ...authHeaders(token), ...(options.headers || {}) },
  });
}

const MAX_CHECK_PAGES = MAX_CHECK_STATUS_PAGES;

export function resolveGitHubLinkNextPage({ trustedOrigin, currentUrl, linkHeader, pageIndex, maxPages }) {
  const nextRaw = parseLinkHeader(linkHeader).next ?? null;
  if (!nextRaw) {
    return { nextUrl: null, truncated: false };
  }
  if (!isTrustedPaginationUrl(trustedOrigin, nextRaw, currentUrl)) {
    return { nextUrl: null, truncated: true };
  }
  if (pageIndex === maxPages - 1) {
    return { nextUrl: null, truncated: true };
  }
  return { nextUrl: new URL(nextRaw, currentUrl).href, truncated: false };
}

async function paginateGitHubLinkPages({
  trustedOrigin,
  startUrl,
  token,
  initialLimit = DEFAULT_CHECK_STATUS_PAGE_SIZE,
  mapPageItems,
  seededFirstPage = null,
}) {
  const all = [];
  let truncated = false;
  let walkedCount = 0;
  let url = startUrl;
  let activeLimit = initialLimit;
  let pageIndex = 0;

  if (seededFirstPage) {
    const { items, linkHeader, currentUrl, usedLimit } = seededFirstPage;
    activeLimit = usedLimit;
    const mapped = mapPageItems(items);
    walkedCount += mapped.length;
    all.push(...mapped);
    const linkPage = resolveGitHubLinkNextPage({
      trustedOrigin,
      currentUrl,
      linkHeader,
      pageIndex: 0,
      maxPages: MAX_CHECK_PAGES,
    });
    if (linkPage.truncated) {
      truncated = true;
    }
    url = linkPage.nextUrl ? withPerPageParam(linkPage.nextUrl, activeLimit) : null;
    pageIndex = 1;
  }

  for (let page = pageIndex; page < MAX_CHECK_PAGES && url; page += 1) {
    const currentUrl = url;
    let usedLimit = activeLimit;
    const { body, headers } = await fetchWithIngestPageBackoff(
      (attemptUrl) =>
        fetchJsonWithMeta(attemptUrl, {
          headers: authHeaders(token),
        }),
      (limit) => {
        usedLimit = limit;
        return withPerPageParam(currentUrl, limit);
      },
      activeLimit,
    );
    activeLimit = usedLimit;
    const mapped = mapPageItems(body);
    walkedCount += mapped.length;
    all.push(...mapped);
    const linkHeader = headers?.get?.('link') ?? headers?.get?.('Link') ?? null;
    const linkPage = resolveGitHubLinkNextPage({
      trustedOrigin,
      currentUrl,
      linkHeader,
      pageIndex: page,
      maxPages: MAX_CHECK_PAGES,
    });
    if (linkPage.truncated) {
      truncated = true;
    }
    url = linkPage.nextUrl ? withPerPageParam(linkPage.nextUrl, activeLimit) : null;
  }
  return { items: all, truncated, walked_count: walkedCount };
}

export async function githubFetchPaginated(config, parsed, path, slice) {
  const base = apiBase(config, parsed);
  const trustedOrigin = new URL(base).origin;
  const { token } = requireToken();
  const pageQuery = `${path.includes('?') ? '&' : '?'}per_page=${DEFAULT_CHECK_STATUS_PAGE_SIZE}`;
  const startUrl = `${base}${path}${pageQuery}`;
  return paginateGitHubLinkPages({
    trustedOrigin,
    startUrl,
    token,
    mapPageItems: (body) => slice(body),
  });
}

export function graphqlEndpoint(config, parsed = {}) {
  const remoteHost = (parsed.host || configuredHost(config) || '').toLowerCase();
  if (remoteHost === PUBLIC_GITHUB_HOST) {
    return PUBLIC_GITHUB_GRAPHQL;
  }
  const origin = configOrigin(config) || `https://${parsed.host}`;
  return `${origin.replace(/\/$/, '')}/api/graphql`;
}

export function mapMergeStateStatus(status) {
  if (!status) return undefined;
  return String(status).toLowerCase();
}

export function graphqlPullToRestShape(node) {
  if (!node) return null;
  let mergeable = null;
  if (node.mergeable === 'CONFLICTING') mergeable = false;
  else if (node.mergeable === 'MERGEABLE') mergeable = true;

  return {
    number: node.number,
    html_url: node.url,
    title: node.title,
    state: mapMergeStateStatus(node.state),
    mergeable,
    mergeable_state: mapMergeStateStatus(node.mergeStateStatus),
    base: { ref: node.baseRefName, sha: node.baseRefOid },
    head: { ref: node.headRefName, sha: node.headRefOid },
  };
}

export async function githubGraphql(config, parsed, query, variables) {
  const { token } = requireToken();
  const url = graphqlEndpoint(config, parsed);
  const body = await fetchJson(url, {
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (body.errors?.length) {
    const message = sanitizeField(body.errors[0]?.message) || 'GraphQL request failed';
    throw Object.assign(new Error(message), {
      forgeError: forgeError(ERROR_CODES.API_ERROR, message),
    });
  }

  return body.data;
}

export async function fetchPullGraphql(config, parsed, number) {
  if (number == null) {
    throw Object.assign(new Error('--number required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, 'Provide --number for PR lookup'),
    });
  }

  const data = await githubGraphql(config, parsed, PR_VIEW_QUERY, {
    owner: config.owner,
    repo: config.repo,
    number,
  });

  const pr = graphqlPullToRestShape(data?.repository?.pullRequest);
  if (!pr) {
    throw Object.assign(new Error('Pull request not found'), {
      forgeError: forgeError(ERROR_CODES.API_ERROR, `Pull request ${number} not found`),
    });
  }

  return pr;
}

export async function repoStatus(ctx) {
  const auth = githubToken();
  let defaultBranch = null;
  if (auth.token) {
    const repo = await githubFetch(ctx.config, ctx.parsed, repoApiPath(ctx.config));
    defaultBranch = sanitizeField(repo.default_branch);
  }
  return {
    auth_present: Boolean(auth.token),
    auth_env: auth.env,
    capabilities: auth.token ? AUTH_CAPABILITIES : ['repo_status'],
    default_branch: defaultBranch,
  };
}

export function providerCapabilities() {
  const check_sources = ['commit_statuses', 'check_runs'];
  return {
    commands: STRUCTURED_COMMANDS,
    auth_envs: ['GITHUB_TOKEN', 'GH_TOKEN'],
    check_sources,
    mergeability_confidence: 'derived',
    host_binding: 'verified_remote_host',
    pagination: 'supported',
    write_support: false,
    ...forgeIngestCapabilityFacts(),
    ...checkPaginationCapabilityFacts({
      strategy: 'link_header',
      pageSizeParam: 'per_page',
      sourceCount: check_sources.length,
    }),
    ...openPullListCapabilityFacts({
      totalCountSource: 'search_api',
    }),
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
  const counts = gitAheadBehind(ctx.cwd, baseSha, headSha);
  return {
    base_ref: sanitizeField(baseRef),
    base_sha: baseSha,
    head_ref: sanitizeField(headRef),
    head_sha: headSha,
    ...counts,
  };
}

export function mergeability(pr) {
  if (pr.mergeable === false || pr.mergeable_state === 'dirty') return 'conflicted';
  if (pr.mergeable === true) {
    if (!pr.mergeable_state || ['clean', 'has_hooks', 'unstable'].includes(pr.mergeable_state)) {
      return 'clean';
    }
  }
  return 'unknown';
}

export async function prView(ctx, opts) {
  const pr = await fetchPullGraphql(ctx.config, ctx.parsed, opts.number);
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

function normalizeCommitStatusState(state) {
  if (state === 'success') return 'success';
  if (state === 'pending') return 'pending';
  if (state === 'failure' || state === 'error') return 'failure';
  return 'unknown';
}

function normalizeCheckRunState(run) {
  if (run.status && run.status !== 'completed') return 'pending';
  if (run.conclusion === 'success' || run.conclusion === 'neutral' || run.conclusion === 'skipped') {
    return 'success';
  }
  if (
    run.conclusion === 'failure' ||
    run.conclusion === 'timed_out' ||
    run.conclusion === 'cancelled' ||
    run.conclusion === 'action_required' ||
    run.conclusion === 'startup_failure'
  ) {
    return 'failure';
  }
  if (!run.conclusion) return 'pending';
  return 'unknown';
}

function checkRunDescription(run) {
  return run.output?.title || run.output?.summary || run.conclusion || run.status || null;
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
    const pr = await fetchPullGraphql(ctx.config, ctx.parsed, opts.number);
    sha = pr.head?.sha;
  }
  if (!sha) {
    throw Object.assign(new Error('No SHA'), {
      forgeError: forgeError(ERROR_CODES.MISSING_REF, 'Could not determine head SHA for checks'),
    });
  }

  const statusPath = repoApiPath(ctx.config, 'commits', sha, 'statuses');
  const checkRunsPath = repoApiPath(ctx.config, 'commits', sha, 'check-runs');
  const [statusResult, checkRunResult] = await Promise.all([
    githubFetchPaginated(ctx.config, ctx.parsed, statusPath, (body) =>
      Array.isArray(body) ? body : [],
    ),
    githubFetchPaginated(ctx.config, ctx.parsed, checkRunsPath, (body) => body?.check_runs ?? []),
  ]);
  const statusRecords = statusResult.items;
  const checkRunRecords = checkRunResult.items;
  const mappedStatuses = statusRecords.map((s) => ({
    context: sanitizeField(s.context),
    state: normalizeCommitStatusState(s.state),
    description: sanitizeField(s.description),
  }));
  const mappedCheckRuns = checkRunRecords.map((run) => ({
    context: sanitizeField(run.name),
    state: normalizeCheckRunState(run),
    description: sanitizeField(checkRunDescription(run)),
  }));
  const mapped = [...mappedStatuses, ...mappedCheckRuns];
  const checks_truncated = statusResult.truncated || checkRunResult.truncated;
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
  return buildMergePlanBodyFromFacts(ctx, view, checks, opts);
}

const GITHUB_OPEN_PULL_COMPLIANT_MAX =
  DEFAULT_OPEN_PULL_LIST_PAGE_SIZE * MAX_CHECK_STATUS_PAGES;
const GITHUB_PAGE_SIZE = 100;

function githubOpenPullsListPath(config, sliceSort) {
  const params = new URLSearchParams({ state: 'open', ...githubOpenPullSortQuery(sliceSort) });
  return `${repoApiPath(config, 'pulls')}?${params.toString()}`;
}

async function fetchGitHubOpenPullSearchTotal(ctx) {
  const base = apiBase(ctx.config, ctx.parsed);
  const { token } = requireToken();
  const owner = encodeURIComponent(ctx.config.owner);
  const repo = encodeURIComponent(ctx.config.repo);
  const searchPath = `/search/issues?q=repo:${owner}/${repo}+is:pr+state:open&per_page=1`;
  try {
    const { body } = await fetchJsonWithMeta(`${base}${searchPath}`, {
      headers: authHeaders(token),
    });
    if (!body || body.incomplete_results === true) return null;
    const total = Number(body.total_count);
    const maxTrusted = GITHUB_OPEN_PULL_COMPLIANT_MAX * 2;
    if (!Number.isInteger(total) || total <= 0 || total > maxTrusted) return null;
    return total;
  } catch {
    return null;
  }
}

async function probeGitHubOpenPullPageOne(ctx, retainMax, sliceSort) {
  const totalCount = await fetchGitHubOpenPullSearchTotal(ctx);
  if (totalCount == null) return null;

  const base = apiBase(ctx.config, ctx.parsed);
  const { token } = requireToken();
  const requestLimit = Math.min(retainMax, GITHUB_PAGE_SIZE);
  const listPath = githubOpenPullsListPath(ctx.config, sliceSort);
  const listUrl = withPerPageParam(`${base}${listPath}`, requestLimit);
  try {
    const { body, headers } = await fetchJsonWithMeta(listUrl, {
      headers: authHeaders(token),
    });
    if (!Array.isArray(body)) return null;
    const listTruncated = totalCount > GITHUB_OPEN_PULL_COMPLIANT_MAX;
    const linkHeader = headers?.get?.('link') ?? headers?.get?.('Link') ?? null;
    return { body, totalCount, listTruncated, requestLimit, listUrl, linkHeader };
  } catch {
    return null;
  }
}

function buildGitHubOpenPullMetaFromPage(body, retainMax, sliceSort, totalCount, listTruncated) {
  let numbers = orderOpenPullNumbers(body, (pr) => pr?.number, sliceSort);
  if (numbers.length > retainMax) numbers = numbers.slice(0, retainMax);
  return buildOpenPullListMeta({
    totalCount,
    numbers,
    listTruncated,
    sliceSort,
  });
}

function githubProbePaginationOpts(probe) {
  const { body, totalCount, requestLimit, listUrl, linkHeader } = probe;
  return {
    trustedTotalCount: totalCount,
    seededFirstPage: { items: body, usedLimit: requestLimit, listUrl, linkHeader },
  };
}

async function paginateGitHubOpenPullList(ctx, opts, sliceSort, paginationOpts = {}) {
  const {
    trustedTotalCount = null,
    seededFirstPage = null,
    numberSortFullCollect = false,
  } = paginationOpts;
  const base = apiBase(ctx.config, ctx.parsed);
  const { token } = requireToken();
  const listLimit =
    opts.limit != null && Number.isInteger(Number(opts.limit)) && Number(opts.limit) > 0
      ? Number(opts.limit)
      : null;
  const all = [];
  let listTruncated = false;
  let walkedCount = 0;
  const listPath = githubOpenPullsListPath(ctx.config, sliceSort);
  const retainMax =
    listLimit == null &&
    opts.retain_max != null &&
    Number.isInteger(Number(opts.retain_max)) &&
    Number(opts.retain_max) > 0
      ? Number(opts.retain_max)
      : null;

  if (listLimit == null && numberSortFullCollect) {
    const {
      items: offsetItems,
      list_truncated: offsetTruncated,
      walked_count: offsetWalkedCount,
    } = await paginateOffsetListPages({
      pageSize: GITHUB_PAGE_SIZE,
      retainMax: null,
      trustedEntryCount: trustedTotalCount,
      seededFirstPage: seededFirstPage
        ? { items: seededFirstPage.items, usedLimit: seededFirstPage.usedLimit }
        : null,
      fetchPage: async ({ page, limit }) => {
        const pageUrl = `${base}${listPath}&page=${page}`;
        const { body } = await fetchJsonWithMeta(withPerPageParam(pageUrl, limit), {
          headers: authHeaders(token),
        });
        return Array.isArray(body) ? body : [];
      },
    });
    all.push(...offsetItems);
    listTruncated = offsetTruncated;
    walkedCount = offsetWalkedCount;
  } else if (listLimit == null) {
    const trustedOrigin = new URL(base).origin;
    const startUrl = `${base}${listPath}`;
    const linkSeed = seededFirstPage
      ? {
          items: seededFirstPage.items,
          linkHeader: seededFirstPage.linkHeader,
          currentUrl: seededFirstPage.listUrl,
          usedLimit: seededFirstPage.usedLimit,
        }
      : null;
    const {
      items: linkItems,
      truncated: linkTruncated,
      walked_count: linkWalkedCount,
    } = await paginateGitHubLinkPages({
      trustedOrigin,
      startUrl,
      token,
      initialLimit: seededFirstPage?.usedLimit ?? DEFAULT_CHECK_STATUS_PAGE_SIZE,
      mapPageItems: (body) => (Array.isArray(body) ? body : []),
      seededFirstPage: linkSeed,
    });
    all.push(...linkItems);
    listTruncated = linkTruncated;
    walkedCount = linkWalkedCount;
  } else {
    const {
      items: limitItems,
      list_truncated: limitTruncated,
      walked_count: limitWalkedCount,
    } = await paginateOffsetListPages({
      pageSize: GITHUB_PAGE_SIZE,
      listLimit,
      maxPagesTruncatesWithLimit: true,
      trustedEntryCount: trustedTotalCount,
      seededFirstPage: seededFirstPage
        ? { items: seededFirstPage.items, usedLimit: seededFirstPage.usedLimit }
        : null,
      fetchPage: async ({ page, limit }) => {
        const pageUrl = `${base}${listPath}&page=${page}`;
        const { body } = await fetchJsonWithMeta(withPerPageParam(pageUrl, limit), {
          headers: authHeaders(token),
        });
        return Array.isArray(body) ? body : [];
      },
    });
    all.push(...limitItems);
    listTruncated = limitTruncated;
    walkedCount = limitWalkedCount;
  }

  let numbers = orderOpenPullNumbers(all, (pr) => pr?.number, sliceSort);
  const outputCap = listLimit ?? retainMax;
  if (outputCap != null && numbers.length > outputCap) {
    numbers = numbers.slice(0, outputCap);
  }
  const entryCount =
    trustedTotalCount != null
      ? resolvePaginatedEntryCount(trustedTotalCount, walkedCount)
      : undefined;
  return {
    numbers,
    list_truncated: resolveListTruncatedWithTrustedTotal({
      listTruncated,
      trustedTotalCount,
      walkedCount,
      fullCollect: numberSortFullCollect,
    }),
    slice_sort: sliceSort,
    ...(entryCount != null ? { entry_count: entryCount } : {}),
  };
}

export async function listOpenPullsWithMeta(ctx, opts = {}) {
  apiBase(ctx.config, ctx.parsed);
  requireToken();
  const sliceSort = normalizeCrInventorySort(opts.sort ?? DEFAULT_CR_INVENTORY_SLICE_SORT);
  if (!isCrInventoryFastPathEligible(opts)) {
    return paginateGitHubOpenPullList(ctx, opts, sliceSort);
  }

  const retainMax = Number(opts.retain_max);
  const probe = await probeGitHubOpenPullPageOne(ctx, retainMax, sliceSort);
  if (!probe) {
    return paginateGitHubOpenPullList(ctx, opts, sliceSort);
  }

  const { body, totalCount, listTruncated, requestLimit } = probe;

  if (listTruncated) {
    if (body.length === 0) {
      return paginateGitHubOpenPullList(ctx, opts, sliceSort, githubProbePaginationOpts(probe));
    }
    return buildGitHubOpenPullMetaFromPage(body, retainMax, sliceSort, totalCount, true);
  }

  if (
    isNumberSortFastPathEligible(totalCount, retainMax, sliceSort) &&
    validateFastPathPageLength(totalCount, requestLimit, body.length)
  ) {
    return buildGitHubOpenPullMetaFromPage(body, retainMax, sliceSort, totalCount, false);
  }

  return paginateGitHubOpenPullList(
    ctx,
    opts,
    sliceSort,
    {
      ...githubProbePaginationOpts(probe),
      numberSortFullCollect: isNumberSortFullCollectRequired(totalCount, retainMax, sliceSort),
    },
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

export const provider = {
  id: 'github-api',
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
