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
  buildChangeRequestOpenedBody,
  buildIssueOpenedBody,
  parseIssueOpenArgs,
  buildCommitStatusSetBody,
  idempotencyPacketFields,
  parseStatusSetArgs,
  normalizeStatusSetState,
  buildProviderIdentityFromGiteaUser,
  buildBranchProtectionFromGiteaProtection,
  buildPrChecksBody,
  buildCrFilesBody,
  buildCrFilesFromGiteaFiles,
  buildCrCommentsBody,
  buildCrCommentsFromGiteaComments,
  buildForgeChangesFromGiteaPulls,
  buildChecksConclusionObservedEvent,
  appendForgeChangeEvents,
  parseSinceObservedAt,
  ERROR_CODES,
  forgeError,
  assertExpectedSha,
  LIVE_REACHABILITY_TIMEOUT_MS,
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
  resolveListTruncatedWithTrustedTotal,
  prepareGiteaOpenPullPageItems,
  orderOpenPullNumbers,
  buildOpenPullListMeta,
  giteaOpenPullSortQuery,
  appendSortQuery,
  assertWriteCommandConfigured,
  fetchWithTimeout,
  readStreamCapped,
  getEffectiveIngestMaxBytes,
} from '@remogram/core';
import {
  resolveBranchProtection,
  setBranchProtectionImpl,
} from './branch-protection-internal.js';
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
  'status_set',
  'whoami',
  'branch_protection',
  'cr_files',
  'cr_comments',
  'forge_changes',
];

const STRUCTURED_COMMANDS = apiProviderCommands({
  writeCommandsImplemented: true,
  issueOpenImplemented: true,
  statusSetImplemented: true,
  branchProtectionImplemented: true,
  crFilesImplemented: true,
  crCommentsImplemented: true,
  forgeChangesImplemented: true,
  mergeExecuteImplemented: true,
});

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
  return repoApiPathFor(config.owner, config.repo, ...segments);
}

export function repoApiPathFor(owner, repo, ...segments) {
  const encodedOwner = encodeURIComponent(owner);
  const encodedRepo = encodeURIComponent(repo);
  const base = `/repos/${encodedOwner}/${encodedRepo}`;
  if (!segments.length) return base;
  return `${base}/${segments.map((s) => encodeURIComponent(String(s))).join('/')}`;
}

export function forgeSourceRepoIdFromPull(config, pr) {
  const headOwner = sanitizeField(pr.head?.repo?.owner?.login ?? pr.head?.repo?.owner?.name);
  const headRepo = sanitizeField(pr.head?.repo?.name);
  if (!headOwner || !headRepo) return null;
  const configOwner = String(config.owner ?? '').toLowerCase();
  const configRepo = String(config.repo ?? '').toLowerCase();
  if (headOwner.toLowerCase() === configOwner && headRepo.toLowerCase() === configRepo) return null;
  return `${headOwner}/${headRepo}`;
}

export function isGiteaHeadOutOfDate409(err) {
  const status = err.status ?? err.forgeError?.status ?? null;
  if (status !== 409) return false;
  const message = err.forgeError?.message ?? err.message ?? '';
  if (/head out of date/i.test(message)) return true;
  if (/sha mismatch/i.test(message)) return true;
  return false;
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

export async function apiReachability(ctx) {
  if (!giteaToken()) {
    throw Object.assign(new Error('GITEA_TOKEN not set'), {
      forgeError: forgeError(ERROR_CODES.UNAUTHENTICATED_PROVIDER, 'GITEA_TOKEN not set'),
    });
  }
  const token = requireToken();
  const url = `${apiBase(ctx.config, ctx.parsed)}${repoApiPath(ctx.config)}`;
  await fetchJson(
    url,
    { headers: authHeaders(token) },
    LIVE_REACHABILITY_TIMEOUT_MS,
  );
  return { repo_accessible: true };
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

export function mapGiteaCommitStatuses(records, { headSha } = {}) {
  return dedupeGiteaStatusRecords(records).map((s) => ({
    context: sanitizeField(s.context),
    state: normalizeGiteaStatusState(s.status ?? s.state),
    description: sanitizeField(s.description),
    ...(s.target_url ? { target_url: sanitizeField(s.target_url) } : {}),
    ...(headSha ? { sha: headSha } : {}),
    source: 'commit_status',
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

export async function whoami(ctx) {
  requireToken();
  const user = await giteaFetch(ctx.config, ctx.parsed, '/user');
  return buildProviderIdentityFromGiteaUser(user);
}

export async function branchProtection(ctx, { branchRef }) {
  requireToken();
  try {
    const protection = await giteaFetch(
      ctx.config,
      ctx.parsed,
      repoApiPath(ctx.config, 'branch_protections', branchRef),
    );
    return buildBranchProtectionFromGiteaProtection(branchRef, protection);
  } catch (err) {
    if (err?.status === 404) {
      return buildBranchProtectionFromGiteaProtection(branchRef, null);
    }
    throw err;
  }
}

export async function branchHeadSha(ctx, branchRef, { repoId } = {}) {
  requireToken();
  assertGitRef(branchRef, 'head_ref');
  let owner = ctx.config.owner;
  let repo = ctx.config.repo;
  if (repoId) {
    const parts = String(repoId).split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw Object.assign(new Error('Invalid repoId'), {
        forgeError: forgeError(ERROR_CODES.INVALID_ARGS, 'repoId must be owner/repo'),
      });
    }
    owner = parts[0];
    repo = parts[1];
  }
  const branch = await giteaFetch(
    ctx.config,
    ctx.parsed,
    repoApiPathFor(owner, repo, 'branches', branchRef),
  );
  const rawSha = sanitizeField(branch?.commit?.id);
  if (!rawSha) {
    throw Object.assign(new Error('Branch commit id missing'), {
      forgeError: forgeError(
        ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT,
        'Gitea branch response missing commit id',
      ),
    });
  }
  try {
    return assertExpectedSha(rawSha, 'branch commit id');
  } catch (err) {
    throw Object.assign(new Error('Branch commit id invalid'), {
      forgeError: forgeError(
        ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT,
        sanitizeField(err.invalidArgs) || 'Gitea branch response commit id is not a valid SHA',
      ),
    });
  }
}

export async function crFiles(ctx, { number }) {
  requireToken();
  if (number == null) {
    throw Object.assign(new Error('--number required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, 'Provide --number for PR changed paths'),
    });
  }
  const path = repoApiPath(ctx.config, 'pulls', number, 'files');
  const pageSep = path.includes('?') ? '&' : '?';
  let activeLimit = DEFAULT_CHECK_STATUS_PAGE_SIZE;
  const allFiles = [];
  let listTruncated = false;
  let entryCount = 0;

  for (let page = 1; page <= MAX_CHECK_PAGES; page += 1) {
    const { items, usedLimit } = await fetchPageWithIngestBackoff(
      async ({ page: pageNum, limit }) => {
        const body = await giteaFetch(
          ctx.config,
          ctx.parsed,
          `${path}${pageSep}limit=${limit}&page=${pageNum}`,
        );
        if (!Array.isArray(body)) {
          throw Object.assign(new Error('Provider returned non-array pull files list'), {
            forgeError: forgeError(
              ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT,
              'Provider returned non-array pull files list',
            ),
          });
        }
        return body;
      },
      page,
      activeLimit,
    );
    activeLimit = usedLimit;
    entryCount += items.length;
    allFiles.push(...items);
    if (items.length < usedLimit) break;
    if (page === MAX_CHECK_PAGES) {
      listTruncated = true;
    }
  }

  const body = buildCrFilesFromGiteaFiles(number, allFiles);
  if (listTruncated) {
    return buildCrFilesBody({
      pr_number: body.pr_number,
      changed_paths: body.changed_paths,
      paths_truncated: true,
      path_count: entryCount,
    });
  }
  return body;
}

export async function crComments(ctx, { number }) {
  requireToken();
  if (number == null) {
    throw Object.assign(new Error('--number required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, 'Provide --number for PR review comments'),
    });
  }
  const path = repoApiPath(ctx.config, 'pulls', number, 'comments');
  const pageSep = path.includes('?') ? '&' : '?';
  let activeLimit = DEFAULT_CHECK_STATUS_PAGE_SIZE;
  const allComments = [];
  let listTruncated = false;
  let entryCount = 0;

  for (let page = 1; page <= MAX_CHECK_PAGES; page += 1) {
    const { items, usedLimit } = await fetchPageWithIngestBackoff(
      async ({ page: pageNum, limit }) => {
        const body = await giteaFetch(
          ctx.config,
          ctx.parsed,
          `${path}${pageSep}limit=${limit}&page=${pageNum}`,
        );
        if (!Array.isArray(body)) {
          throw Object.assign(new Error('Provider returned non-array pull comments list'), {
            forgeError: forgeError(
              ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT,
              'Provider returned non-array pull comments list',
            ),
          });
        }
        return body;
      },
      page,
      activeLimit,
    );
    activeLimit = usedLimit;
    entryCount += items.length;
    allComments.push(...items);
    if (items.length < usedLimit) break;
    if (page === MAX_CHECK_PAGES) {
      listTruncated = true;
    }
  }

  const body = buildCrCommentsFromGiteaComments(number, allComments);
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

export async function forgeChanges(ctx, { since }) {
  requireToken();
  const sinceIso = parseSinceObservedAt(since);
  const path = `${repoApiPath(ctx.config, 'pulls')}?state=all&sort=recentupdate`;
  const pageSep = '&';
  let activeLimit = GITEA_PAGE_SIZE;
  const allPulls = [];
  let listTruncated = false;
  let entryCount = 0;

  for (let page = 1; page <= MAX_CHECK_PAGES; page += 1) {
    const { items, usedLimit } = await fetchPageWithIngestBackoff(
      async ({ page: pageNum, limit }) => {
        const body = await giteaFetch(
          ctx.config,
          ctx.parsed,
          `${path}${pageSep}limit=${limit}&page=${pageNum}`,
        );
        if (!Array.isArray(body)) {
          throw Object.assign(new Error('Provider returned non-array pull list'), {
            forgeError: forgeError(
              ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT,
              'Provider returned non-array pull list',
            ),
          });
        }
        return body;
      },
      page,
      activeLimit,
    );
    activeLimit = usedLimit;
    entryCount += items.length;
    allPulls.push(...items);
    if (items.length < usedLimit) break;
    if (page === MAX_CHECK_PAGES) {
      listTruncated = true;
    }
  }

  let body = buildForgeChangesFromGiteaPulls(sinceIso, allPulls, { listTruncated });
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
    write_commands: ['cr_open', 'status_set', 'merge', 'issue_open'],
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
    compare_base_ref: sanitizeField(baseRef),
    compare_base_sha: baseSha,
    compare_head_ref: sanitizeField(headRef),
    compare_head_sha: headSha,
    ...counts,
  };
}

export async function getPull(ctx, { number }) {
  if (number == null) {
    throw Object.assign(new Error('--number required'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, 'Provide --number for PR lookup'),
    });
  }
  return giteaFetchPullForView(ctx.config, ctx.parsed, number);
}

/** Raw read bound for pull view before stripping bulky fields (#478). */
const GITEA_PULL_VIEW_RAW_READ_MAX = 256 * 1024;

function stripGiteaPullBulkJsonFields(raw) {
  return String(raw)
    .replace(/"body"\s*:\s*"(?:\\.|[^"\\])*"/g, '"body":""')
    .replace(/"body_html"\s*:\s*"(?:\\.|[^"\\])*"/g, '"body_html":""')
    .replace(/"diff"\s*:\s*"(?:\\.|[^"\\])*"/g, '"diff":""')
    .replace(/"patch"\s*:\s*"(?:\\.|[^"\\])*"/g, '"patch":""');
}

async function giteaFetchPullForView(config, parsed, number) {
  const token = requireToken();
  const url = `${apiBase(config, parsed)}${repoApiPath(config, 'pulls', number)}`;
  const res = await fetchWithTimeout(url, { headers: authHeaders(token) });
  if (res.status >= 300 && res.status < 400) {
    const message = 'HTTP redirect rejected';
    throw Object.assign(new Error(message), {
      forgeError: forgeError(ERROR_CODES.API_ERROR, message, res.status),
      status: res.status,
    });
  }
  const capped = await readStreamCapped(res.body, GITEA_PULL_VIEW_RAW_READ_MAX);
  if (capped.truncated) {
    throw Object.assign(new Error('Provider output exceeded cap'), {
      forgeError: forgeError(ERROR_CODES.OVERSIZED_RAW_OUTPUT, 'Provider response exceeded byte cap'),
      status: res.status,
    });
  }
  const stripped = stripGiteaPullBulkJsonFields(capped.text);
  if (Buffer.byteLength(stripped, 'utf8') > getEffectiveIngestMaxBytes().bytes) {
    throw Object.assign(new Error('Provider output exceeded cap after projection'), {
      forgeError: forgeError(ERROR_CODES.OVERSIZED_RAW_OUTPUT, 'Provider response exceeded byte cap'),
      status: res.status,
    });
  }
  let body;
  try {
    body = stripped ? JSON.parse(stripped) : null;
  } catch {
    throw Object.assign(new Error('Unparseable JSON from provider'), {
      forgeError: forgeError(ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT, 'Provider returned invalid JSON'),
      status: res.status,
    });
  }
  if (!res.ok) {
    const raw = body?.message || body?.error || res.statusText || 'API error';
    const message = sanitizeField(raw) || 'API error';
    throw Object.assign(new Error(message), {
      forgeError: forgeError(ERROR_CODES.API_ERROR, message, res.status),
      status: res.status,
    });
  }
  return body;
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

function issueOpenIdempotencyScanIncompleteError(pagesScanned, pageSizeUsed) {
  return forgeError(
    ERROR_CODES.IDEMPOTENCY_SCAN_INCOMPLETE,
    'Cannot prove no open issue exists for title within scan limit; retry or open manually',
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

/** Paginated open-issue scan for idempotent issue open; fail-closed when scan cap prevents proof of absence. */
export async function findOpenIssueByTitle(ctx, title) {
  requireToken();
  const path = `${repoApiPath(ctx.config, 'issues')}?state=open`;
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
          throw Object.assign(new Error('Provider returned non-array open issue list'), {
            forgeError: forgeError(
              ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT,
              'Provider returned non-array open issue list',
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
        (issue) =>
          String(issue?.state ?? '').toLowerCase() === 'open' &&
          sanitizeField(issue?.title ?? '') === title,
      ) ?? null;
    if (match) return match;
    if (items.length < usedLimit) return null;
    if (page === MAX_OPEN_PULL_IDEMPOTENCY_PAGES) {
      throw Object.assign(new Error('Open issue idempotency scan incomplete'), {
        forgeError: issueOpenIdempotencyScanIncompleteError(page, usedLimit),
      });
    }
  }
  return null;
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
  const path = repoApiPath(ctx.config, 'commits', sha, 'statuses');
  const pageSep = path.includes('?') ? '&' : '?';
  let activeLimit = GITEA_PAGE_SIZE;
  let bestMatch = null;

  for (let page = 1; page <= MAX_OPEN_PULL_IDEMPOTENCY_PAGES; page += 1) {
    const { items, usedLimit } = await fetchPageWithIngestBackoff(
      async ({ page: pageNum, limit }) => {
        const body = await giteaFetch(
          ctx.config,
          ctx.parsed,
          `${path}${pageSep}limit=${limit}&page=${pageNum}`,
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
      if (record?.context !== context) continue;
      if (!bestMatch || giteaStatusRecordOrder(record, bestMatch) > 0) {
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
  const { idempotencyFingerprint = null, ...rest } = args;
  const parsed = parseStatusSetArgs(rest);
  const existing = await findCommitStatusByContext(ctx, parsed.sha, parsed.context);
  if (existing) {
    const existingState = normalizeStatusSetState(existing.status ?? existing.state);
    if (existingState === parsed.state) {
      return buildCommitStatusSetBody(existing, parsed, {
        reusedExisting: true,
        idempotencyFields: idempotencyFingerprint
          ? idempotencyPacketFields(idempotencyFingerprint, { reusedExisting: true })
          : null,
      });
    }
  }
  const payload = {
    state: parsed.state,
    context: parsed.context,
  };
  if (parsed.description != null) payload.description = parsed.description;
  if (parsed.target_url != null) payload.target_url = parsed.target_url;
  const response = await giteaFetch(
    ctx.config,
    ctx.parsed,
    repoApiPath(ctx.config, 'statuses', parsed.sha),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  return buildCommitStatusSetBody(response, parsed, {
    idempotencyFields: idempotencyFingerprint
      ? idempotencyPacketFields(idempotencyFingerprint, { reusedExisting: false })
      : null,
  }  );
}

export async function issueOpen(ctx, { title, body: issueBody, idempotencyFingerprint = null }) {
  assertWriteCommandConfigured(ctx.config, 'issue_open');
  const parsed = parseIssueOpenArgs({ title, body: issueBody });
  const existing = await findOpenIssueByTitle(ctx, parsed.title);
  if (existing) {
    return buildIssueOpenedBody(
      existing,
      { title: parsed.title },
      {
        reusedExisting: true,
        idempotencyFields: idempotencyFingerprint
          ? idempotencyPacketFields(idempotencyFingerprint, { reusedExisting: true })
          : null,
      },
    );
  }
  const payload = { title: parsed.title };
  if (parsed.body != null) payload.body = parsed.body;
  const issue = await giteaFetch(ctx.config, ctx.parsed, repoApiPath(ctx.config, 'issues'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return buildIssueOpenedBody(
    issue,
    { title: parsed.title },
    {
      idempotencyFields: idempotencyFingerprint
        ? idempotencyPacketFields(idempotencyFingerprint, { reusedExisting: false })
        : null,
    },
  );
}

export async function crOpen(ctx, { head, base, title, body: prBody, idempotencyFingerprint = null }) {
  assertWriteCommandConfigured(ctx.config, 'cr_open');
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
    return buildChangeRequestOpenedBody(
      existing,
      { head, base, title },
      {
        reusedExisting: true,
        idempotencyFields: idempotencyFingerprint
          ? idempotencyPacketFields(idempotencyFingerprint, { reusedExisting: true })
          : null,
      },
    );
  }
  const pull = await giteaFetch(ctx.config, ctx.parsed, repoApiPath(ctx.config, 'pulls'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return buildChangeRequestOpenedBody(
    pull,
    { head, base, title },
    {
      idempotencyFields: idempotencyFingerprint
        ? idempotencyPacketFields(idempotencyFingerprint, { reusedExisting: false })
        : null,
    },
  );
}

export async function mergeExecute(ctx, { number, method = 'merge', expectedHeadSha }) {
  assertWriteCommandConfigured(ctx.config, 'merge');
  if (method !== 'merge') {
    throw Object.assign(new Error('Unsupported merge method'), {
      forgeError: forgeError(
        ERROR_CODES.INVALID_ARGS,
        'Only --method merge is supported in v1',
      ),
    });
  }
  const pullIndex = Number(number);
  if (!Number.isInteger(pullIndex) || pullIndex <= 0) {
    throw Object.assign(new Error('Invalid PR number'), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, 'PR number must be a positive integer'),
    });
  }
  const headCommitId = assertExpectedSha(expectedHeadSha, 'expectedHeadSha');
  let result;
  try {
    result = await giteaFetch(
      ctx.config,
      ctx.parsed,
      repoApiPath(ctx.config, 'pulls', String(pullIndex), 'merge'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Do: 'merge', head_commit_id: headCommitId }),
      },
    );
  } catch (err) {
    const status = err.status ?? err.forgeError?.status ?? null;
    const message = err.forgeError?.message ?? err.message ?? '';
    if (isGiteaHeadOutOfDate409(err)) {
      throw Object.assign(new Error(message), {
        status,
        mergeBlockedBlockers: ['head_ref_moved'],
        forgeError: forgeError(
          ERROR_CODES.MERGE_BLOCKED,
          sanitizeField(message) || 'Head branch out of date at merge POST',
          status,
        ),
      });
    }
    throw err;
  }
  return {
    commit_sha: sanitizeField(result?.sha ?? result?.merge_commit_sha ?? null),
    provider_status: 200,
    base_sha: sanitizeField(result?.base_sha ?? null),
  };
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

function giteaProbePaginationOpts(probe, extra = {}) {
  const { body, totalCount, requestLimit } = probe;
  return {
    trustedTotalCount: totalCount,
    seededFirstPage: { items: body, usedLimit: requestLimit },
    ...extra,
  };
}

async function paginateGiteaOpenPullList(ctx, opts, sliceSort, paginationOpts = {}) {
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
  const pageSize =
    listLimit != null ? Math.min(listLimit, GITEA_PAGE_SIZE) : GITEA_PAGE_SIZE;
  let path = `${repoApiPath(ctx.config, 'pulls')}?state=open`;
  path = appendSortQuery(path, giteaOpenPullSortQuery(sliceSort));
  const pageSep = path.includes('?') ? '&' : '?';
  const effectiveRetainMax = numberSortFullCollect ? null : retainMax;
  const {
    items: all,
    list_truncated: listTruncated,
    entry_count: entryCount,
    walked_count: walkedCount,
  } = await paginateOffsetListPages({
    pageSize,
    listLimit,
    retainMax: effectiveRetainMax,
    trustedEntryCount: trustedTotalCount,
    seededFirstPage,
    startPage,
    maxPages,
    suppressFinalPageProbe,
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
      return paginateGiteaOpenPullList(ctx, opts, sliceSort, giteaProbePaginationOpts(probe));
    }
    return buildGiteaOpenPullMetaFromPage(body, retainMax, sliceSort, totalCount, true);
  }

  if (
    sliceSort === 'recent_created' &&
    !isRecentCreatedFastPathEligible(totalCount, retainMax, sliceSort, 'gitea-api')
  ) {
    const tail = await fetchGiteaRecentCreatedTailSlice(ctx, retainMax, sliceSort, totalCount);
    if (tail) return tail;
    const tailRetry = await fetchGiteaRecentCreatedTailSlice(ctx, retainMax, sliceSort, totalCount);
    if (tailRetry) return tailRetry;
    const tailPage = giteaRecentCreatedTailPage(totalCount, GITEA_PAGE_SIZE);
    return paginateGiteaOpenPullList(ctx, opts, sliceSort, {
      trustedTotalCount: totalCount,
      startPage: tailPage,
      maxPages: tailPage,
      suppressFinalPageProbe: true,
    });
  }

  if (
    isRecentCreatedFastPathEligible(totalCount, retainMax, sliceSort, 'gitea-api') &&
    isNumberSortFastPathEligible(totalCount, retainMax, sliceSort) &&
    validateFastPathPageLength(totalCount, requestLimit, body.length)
  ) {
    return buildGiteaOpenPullMetaFromPage(body, retainMax, sliceSort, totalCount, false);
  }

  const numberSortFullCollect = isNumberSortFullCollectRequired(totalCount, retainMax, sliceSort);
  return paginateGiteaOpenPullList(
    ctx,
    opts,
    sliceSort,
    giteaProbePaginationOpts(probe, { numberSortFullCollect }),
  );
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
  const body = {
    pr_number: pr.number,
    url: sanitizeUrl(pr.html_url ?? pr.url),
    title: sanitizeField(pr.title),
    state: normalizeGiteaPrState(pr.state),
    forge_target_branch_ref: sanitizeField(pr.base?.ref),
    forge_target_sha: sanitizeField(pr.base?.sha),
    forge_source_branch_ref: sanitizeField(pr.head?.ref),
    forge_source_sha: sanitizeField(pr.head?.sha),
    mergeability: mergeability(pr),
  };
  const forgeSourceRepoId = forgeSourceRepoIdFromPull(ctx.config, pr);
  if (forgeSourceRepoId) body.forge_source_repo_id = forgeSourceRepoId;
  return body;
}

export async function prChecks(ctx, opts) {
  requireToken();
  let sha;
  let requiredContexts = [];
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
    const targetBranch = pr.base?.ref;
    if (targetBranch) {
      try {
        const protection = await resolveBranchProtection(ctx, { branchRef: targetBranch });
        requiredContexts = protection.required_status_contexts ?? [];
      } catch (err) {
        if (err?.status !== 404) throw err;
      }
    }
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
  const mapped = mapGiteaCommitStatuses(statusRecords, { headSha: sha });
  return buildPrChecksBody({
    forge_source_sha: sha,
    check_conclusion: summarizeChecks(mapped),
    checks_truncated,
    statuses: mapped,
    required_contexts: requiredContexts,
  });
}

export function summarizeChecks(statuses) {
  if (!statuses.length) return 'missing';
  if (statuses.some((s) => s.state === 'failure' || s.state === 'error')) return 'failure';
  if (statuses.some((s) => s.state === 'pending')) return 'pending';
  if (statuses.every((s) => s.state === 'success')) return 'success';
  return 'unknown';
}

export async function mergePlan(ctx, opts) {
  return buildMergePlanFromProviderFacts(ctx, opts, { prView, prChecks, crFiles });
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
  apiReachability,
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
  issueOpen,
  mergeExecute,
  statusSet,
  whoami,
  branchProtection,
  branchHeadSha,
  crFiles,
  crComments,
  forgeChanges,
};

setBranchProtectionImpl(branchProtection);
