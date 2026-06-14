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
  buildMergePlanBodyFromFacts,
  buildChangeRequestOpenedBody,
  ERROR_CODES,
  forgeError,
  forgeIngestCapabilityFacts,
  checkPaginationCapabilityFacts,
  idempotencyScanCapabilityFacts,
  openPullListCapabilityFacts,
  DEFAULT_CHECK_STATUS_PAGE_SIZE,
  MAX_CHECK_STATUS_PAGES,
  DEFAULT_OPEN_PULL_LIST_PAGE_SIZE,
  MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
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
  isRecentCreatedFastPathEligible,
  giteaRecentCreatedTailPage,
  isNumberSortFullCollectRequired,
  prepareGiteaOpenPullPageItems,
  orderOpenPullNumbers,
  buildOpenPullListMeta,
  giteaOpenPullSortQuery,
  appendSortQuery,
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
  'cr_open',
];

const STRUCTURED_COMMANDS = apiProviderCommands({ writeCommandsImplemented: true });

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

export async function giteaFetchWithMeta(config, parsed, path, options = {}) {
  const token = requireToken();
  const url = `${apiBase(config, parsed)}${path}`;
  return fetchJsonWithMeta(url, {
    ...options,
    headers: { ...authHeaders(token), ...(options.headers || {}) },
  });
}

const MAX_CHECK_PAGES = MAX_CHECK_STATUS_PAGES;
const GITEA_PAGE_SIZE = DEFAULT_OPEN_PULL_LIST_PAGE_SIZE;

function idempotencyScanIncompleteError(pagesScanned, pageSizeUsed) {
  return forgeError(
    ERROR_CODES.IDEMPOTENCY_SCAN_INCOMPLETE,
    'Cannot prove no open pull exists for head+base within scan limit; use cr inventory or open manually',
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

function giteaStatusRecordOrder(a, b) {
  const aUpdated = Date.parse(a.updated_at ?? '') || 0;
  const bUpdated = Date.parse(b.updated_at ?? '') || 0;
  if (aUpdated !== bUpdated) return aUpdated - bUpdated;
  const aId = Number(a.id) || 0;
  const bId = Number(b.id) || 0;
  return aId - bId;
}

export function dedupeGiteaStatusRecords(records) {
  const latestByContext = new Map();
  for (const record of records) {
    const context = record?.context;
    if (context == null || context === '') continue;
    const existing = latestByContext.get(context);
    if (!existing || giteaStatusRecordOrder(record, existing) > 0) {
      latestByContext.set(context, record);
    }
  }
  return Array.from(latestByContext.values());
}

export function mapGiteaCommitStatuses(records) {
  return dedupeGiteaStatusRecords(records).map((s) => ({
    context: sanitizeField(s.context),
    state: normalizeGiteaStatusState(s.status ?? s.state),
    description: sanitizeField(s.description),
  }));
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
  const check_sources = ['commit_statuses'];
  return {
    commands: STRUCTURED_COMMANDS,
    auth_envs: ['GITEA_TOKEN'],
    check_sources,
    mergeability_confidence: 'direct',
    host_binding: 'verified_remote_host',
    pagination: 'supported',
    write_support: true,
    write_commands: ['cr_open'],
    ...forgeIngestCapabilityFacts(),
    ...checkPaginationCapabilityFacts({
      strategy: 'offset_limit',
      pageSizeParam: 'limit',
      sourceCount: check_sources.length,
    }),
    ...idempotencyScanCapabilityFacts(),
    ...openPullListCapabilityFacts({
      totalCountSource: 'response_header',
      totalCountHeader: 'X-Total-Count',
      sliceSortNotes: {
        recent_created:
          'sort=oldest; fetches tail page when total exceeds limit; page reversed for newest-first',
        number_asc:
          'full-list collect within compliant_max when total exceeds limit, then client sort',
        number_desc:
          'full-list collect within compliant_max when total exceeds limit, then client sort',
      },
    }),
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

/** Paginated open-pull scan for idempotent cr open; fail-closed when scan cap prevents proof of absence. */
export async function findOpenPullByHeadBase(ctx, head, base) {
  requireToken();
  const path = `${repoApiPath(ctx.config, 'pulls')}?state=open`;
  const pageSep = path.includes('?') ? '&' : '?';
  let activeLimit = GITEA_PAGE_SIZE;

  for (let page = 1; page <= MAX_OPEN_PULL_IDEMPOTENCY_PAGES; page += 1) {
    const { items, usedLimit } = await fetchPageWithIngestBackoff(
      async ({ page: pageNum, limit }) => {
        const body = await giteaFetch(
          ctx.config,
          ctx.parsed,
          `${path}${pageSep}limit=${limit}&page=${pageNum}`,
        );
        if (!Array.isArray(body)) {
          throw Object.assign(new Error('Provider returned non-array open pull list'), {
            forgeError: forgeError(
              ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT,
              'Provider returned non-array open pull list',
            ),
          });
        }
        return body;
      },
      page,
      activeLimit,
    );
    activeLimit = usedLimit;

    const match =
      items.find(
        (pr) =>
          String(pr?.state ?? '').toLowerCase() === 'open' &&
          pr?.head?.ref === head &&
          pr?.base?.ref === base,
      ) ?? null;
    if (match) return match;
    if (items.length < usedLimit) return null;
    if (page === MAX_OPEN_PULL_IDEMPOTENCY_PAGES) {
      throw Object.assign(new Error('Open pull idempotency scan incomplete'), {
        forgeError: idempotencyScanIncompleteError(page, usedLimit),
      });
    }
  }
  return null;
}

export async function crOpen(ctx, { head, base, title, body: prBody }) {
  assertGitRef(head, 'head');
  assertGitRef(base, 'base');
  if (!title || typeof title !== 'string' || !title.trim()) {
    throw Object.assign(new Error('--title required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--title required for cr open'),
    });
  }
  const payload = {
    title: sanitizeField(title),
    head: sanitizeField(head),
    base: sanitizeField(base),
  };
  if (prBody != null && String(prBody).trim() !== '') {
    payload.body = sanitizeField(String(prBody));
  }
  const existing = await findOpenPullByHeadBase(ctx, payload.head, payload.base);
  if (existing) {
    return buildChangeRequestOpenedBody(existing, { head, base, title }, { reusedExisting: true });
  }
  const pull = await giteaFetch(ctx.config, ctx.parsed, repoApiPath(ctx.config, 'pulls'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return buildChangeRequestOpenedBody(pull, { head, base, title });
}

const GITEA_OPEN_PULL_COMPLIANT_MAX =
  DEFAULT_OPEN_PULL_LIST_PAGE_SIZE * MAX_CHECK_STATUS_PAGES;

async function probeGiteaOpenPullPageOne(ctx, retainMax, sliceSort) {
  const maxTrusted = GITEA_OPEN_PULL_COMPLIANT_MAX * 2;
  let path = `${repoApiPath(ctx.config, 'pulls')}?state=open`;
  path = appendSortQuery(path, giteaOpenPullSortQuery(sliceSort));
  const pageSep = path.includes('?') ? '&' : '?';
  const requestLimit = Math.min(retainMax, GITEA_PAGE_SIZE);
  try {
    const { body, headers } = await giteaFetchWithMeta(
      ctx.config,
      ctx.parsed,
      `${path}${pageSep}limit=${requestLimit}&page=1`,
    );
    if (!Array.isArray(body)) return null;
    const totalCount = parseTotalCountHeader(headers, 'X-Total-Count', { maxTrusted });
    if (totalCount == null) return null;
    const listTruncated = totalCount > GITEA_OPEN_PULL_COMPLIANT_MAX;
    return { body, totalCount, listTruncated, requestLimit };
  } catch {
    return null;
  }
}

function buildGiteaOpenPullMetaFromPage(body, retainMax, sliceSort, totalCount, listTruncated) {
  const pageItems = prepareGiteaOpenPullPageItems(body, sliceSort);
  let numbers = orderOpenPullNumbers(pageItems, (pr) => pr?.number, sliceSort);
  if (numbers.length > retainMax) numbers = numbers.slice(0, retainMax);
  return buildOpenPullListMeta({
    totalCount,
    numbers,
    listTruncated,
    sliceSort,
  });
}

async function fetchGiteaRecentCreatedTailSlice(ctx, retainMax, sliceSort, totalCount) {
  const tailPage = giteaRecentCreatedTailPage(totalCount, GITEA_PAGE_SIZE);
  let path = `${repoApiPath(ctx.config, 'pulls')}?state=open`;
  path = appendSortQuery(path, giteaOpenPullSortQuery(sliceSort));
  const pageSep = path.includes('?') ? '&' : '?';
  let body;
  try {
    body = await giteaFetch(
      ctx.config,
      ctx.parsed,
      `${path}${pageSep}limit=${GITEA_PAGE_SIZE}&page=${tailPage}`,
    );
  } catch {
    return null;
  }
  if (!Array.isArray(body) || body.length === 0) return null;
  return buildGiteaOpenPullMetaFromPage(body, retainMax, sliceSort, totalCount, false);
}

async function paginateGiteaOpenPullList(ctx, opts, sliceSort, paginationOpts = {}) {
  const { trustedTotalCount = null, numberSortFullCollect = false } = paginationOpts;
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
  const pageSize =
    listLimit != null ? Math.min(listLimit, GITEA_PAGE_SIZE) : GITEA_PAGE_SIZE;
  let path = `${repoApiPath(ctx.config, 'pulls')}?state=open`;
  path = appendSortQuery(path, giteaOpenPullSortQuery(sliceSort));
  const pageSep = path.includes('?') ? '&' : '?';
  const effectiveRetainMax = numberSortFullCollect ? null : retainMax;
  const { items: all, list_truncated: listTruncated, entry_count: entryCount } =
    await paginateOffsetListPages({
      pageSize,
      listLimit,
      retainMax: effectiveRetainMax,
      trustedEntryCount: trustedTotalCount,
      ...(listLimit != null && pageSize < listLimit ? { maxPagesTruncatesWithLimit: true } : {}),
      fetchPage: async ({ page, limit }) => {
        const body = await giteaFetch(
          ctx.config,
          ctx.parsed,
          `${path}${pageSep}limit=${limit}&page=${page}`,
        );
        return Array.isArray(body) ? body : [];
      },
    });
  let numbers = orderOpenPullNumbers(
    prepareGiteaOpenPullPageItems(all, sliceSort),
    (pr) => pr?.number,
    sliceSort,
  );
  const outputCap = listLimit ?? retainMax;
  if (outputCap != null && numbers.length > outputCap) {
    numbers = numbers.slice(0, outputCap);
  }
  return {
    numbers,
    list_truncated: listTruncated,
    ...(entryCount != null ? { entry_count: entryCount } : {}),
    slice_sort: sliceSort,
  };
}

export async function listOpenPullsWithMeta(ctx, opts = {}) {
  requireToken();
  const sliceSort = normalizeCrInventorySort(opts.sort ?? DEFAULT_CR_INVENTORY_SLICE_SORT);
  if (!isCrInventoryFastPathEligible(opts)) {
    return paginateGiteaOpenPullList(ctx, opts, sliceSort);
  }

  const retainMax = Number(opts.retain_max);
  const probe = await probeGiteaOpenPullPageOne(ctx, retainMax, sliceSort);
  if (!probe) {
    return paginateGiteaOpenPullList(ctx, opts, sliceSort);
  }

  const { body, totalCount, listTruncated, requestLimit } = probe;

  if (listTruncated) {
    if (body.length === 0) {
      return paginateGiteaOpenPullList(ctx, opts, sliceSort, { trustedTotalCount: totalCount });
    }
    return buildGiteaOpenPullMetaFromPage(body, retainMax, sliceSort, totalCount, true);
  }

  if (
    sliceSort === 'recent_created' &&
    !isRecentCreatedFastPathEligible(totalCount, retainMax, sliceSort, 'gitea-api')
  ) {
    const tail = await fetchGiteaRecentCreatedTailSlice(ctx, retainMax, sliceSort, totalCount);
    if (tail) return tail;
    return paginateGiteaOpenPullList(ctx, opts, sliceSort, { trustedTotalCount: totalCount });
  }

  if (
    isRecentCreatedFastPathEligible(totalCount, retainMax, sliceSort, 'gitea-api') &&
    isNumberSortFastPathEligible(totalCount, retainMax, sliceSort) &&
    validateFastPathPageLength(totalCount, requestLimit, body.length)
  ) {
    return buildGiteaOpenPullMetaFromPage(body, retainMax, sliceSort, totalCount, false);
  }

  const numberSortFullCollect = isNumberSortFullCollectRequired(totalCount, retainMax, sliceSort);
  return paginateGiteaOpenPullList(ctx, opts, sliceSort, {
    trustedTotalCount: totalCount,
    numberSortFullCollect,
  });
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
  const { items: statusRecords, truncated: checks_truncated } = await giteaFetchPaginated(
    ctx.config,
    ctx.parsed,
    repoApiPath(ctx.config, 'commits', sha, 'statuses'),
  );
  const mapped = mapGiteaCommitStatuses(statusRecords);
  const conclusion = summarizeChecks(mapped);
  return {
    head_sha: sha,
    check_conclusion: conclusion,
    checks_truncated,
    statuses: mapped,
  };
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
  return buildMergePlanBodyFromFacts(ctx, view, checks, opts);
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
  crOpen,
};
