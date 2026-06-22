export const DEFAULT_MAX_BYTES = 8192;
export const DEFAULT_FIELD_MAX_BYTES = 512;
export const FORGE_INGEST_MAX_BYTES_ENV = 'REMOGRAM_FORGE_INGEST_MAX_BYTES';
/** Upper bound for undocumented REMOGRAM_FORGE_INGEST_MAX_BYTES debug override. */
export const MAX_FORGE_INGEST_ENV_BYTES = 65536;

/** Conservative check/status page size vs DEFAULT_MAX_BYTES raw ingest cap (pre-parse). */
export const DEFAULT_CHECK_STATUS_PAGE_SIZE = 25;
export const MAX_CHECK_STATUS_PAGES = 50;

/** Gitea open-pull list page size for idempotency scan and inventory list bounds. */
export const DEFAULT_OPEN_PULL_LIST_PAGE_SIZE = 100;
/** Max pages scanned before cr open idempotency fails closed (decoupled from check-status pagination). */
export const MAX_OPEN_PULL_IDEMPOTENCY_PAGES = 50;

export function getEffectiveIngestMaxBytes() {
  const raw = process.env[FORGE_INGEST_MAX_BYTES_ENV];
  if (raw == null || raw === '') {
    return { bytes: DEFAULT_MAX_BYTES, envOverride: false };
  }
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { bytes: DEFAULT_MAX_BYTES, envOverride: false, invalidEnv: true };
  }
  if (parsed > MAX_FORGE_INGEST_ENV_BYTES) {
    return { bytes: MAX_FORGE_INGEST_ENV_BYTES, envOverride: true, clamped: true };
  }
  return { bytes: parsed, envOverride: true };
}

/** Facts for provider capabilities packets (forge ingest policy). */
export function forgeIngestCapabilityFacts() {
  const { bytes, envOverride, clamped } = getEffectiveIngestMaxBytes();
  return {
    forge_ingest_cap_bytes: bytes,
    ...(envOverride ? { forge_ingest_env_override: true } : {}),
    ...(clamped ? { forge_ingest_cap_clamped: true } : {}),
  };
}

/**
 * Structured check-list pagination facts for provider capabilities.
 * @param {{ strategy: 'offset_limit' | 'link_header', pageSizeParam: 'limit' | 'per_page' | null, sourceCount?: number }} opts
 */
export function checkPaginationCapabilityFacts({ strategy, pageSizeParam, sourceCount = 1 }) {
  const perSource = DEFAULT_CHECK_STATUS_PAGE_SIZE * MAX_CHECK_STATUS_PAGES;
  return {
    check_pagination: {
      strategy,
      page_size: DEFAULT_CHECK_STATUS_PAGE_SIZE,
      max_pages: MAX_CHECK_STATUS_PAGES,
      page_size_param: pageSizeParam,
      ingest_backoff: 'halve_until_fit',
      on_page_cap: 'set_checks_truncated',
      compliant_max_items_per_source: perSource,
      check_source_count: sourceCount,
      truncation_combination:
        sourceCount > 1 ? 'any_source_truncated' : 'single_source',
      compliant_max_items_total: perSource * sourceCount,
      truncation_packet_field: 'checks_truncated',
    },
  };
}

/** Structured idempotency scan facts for provider capabilities (cr open). */
export function idempotencyScanCapabilityFacts() {
  return {
    idempotency_scan: {
      max_pages: MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
      page_size: DEFAULT_OPEN_PULL_LIST_PAGE_SIZE,
      ingest_backoff: 'halve_until_fit',
    },
  };
}

/** Idempotency scan facts for status set (commit-status list pagination). */
export function statusSetIdempotencyScanCapabilityFacts() {
  return {
    idempotency_scan: {
      max_pages: MAX_OPEN_PULL_IDEMPOTENCY_PAGES,
      page_size: DEFAULT_CHECK_STATUS_PAGE_SIZE,
      ingest_backoff: 'halve_until_fit',
    },
  };
}

/** Structured open-pull list pagination facts for provider capabilities (cr inventory). */
export function openPullListCapabilityFacts({
  totalCountSource = null,
  totalCountHeader = null,
  sliceSortNotes = null,
} = {}) {
  const compliantMaxItems = DEFAULT_OPEN_PULL_LIST_PAGE_SIZE * MAX_CHECK_STATUS_PAGES;
  return {
    open_pull_list: {
      max_pages: MAX_CHECK_STATUS_PAGES,
      page_size: DEFAULT_OPEN_PULL_LIST_PAGE_SIZE,
      ingest_backoff: 'halve_until_fit',
      compliant_max_items: compliantMaxItems,
      truncation_packet_field: 'list_truncated',
      incomplete_error_code: 'inventory_list_incomplete',
      default_slice_sort: 'number_asc',
      supported_slice_sorts: [
        'number_asc',
        'number_desc',
        'recent_update',
        'recent_created',
      ],
      ...(totalCountSource ? { total_count_source: totalCountSource } : {}),
      ...(totalCountHeader ? { total_count_header: totalCountHeader } : {}),
      ...(sliceSortNotes ? { slice_sort_notes: sliceSortNotes } : {}),
    },
  };
}

export function capText(text, maxBytes = DEFAULT_MAX_BYTES) {
  if (!text) return { text: '', truncated: false, bytes: 0 };
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) {
    return { text, truncated: false, bytes: buf.length };
  }
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  const slice = buf.subarray(0, end).toString('utf8');
  return { text: slice, truncated: true, bytes: end };
}

export function sanitizeField(value, maxBytes = DEFAULT_FIELD_MAX_BYTES) {
  if (value == null) return null;
  const singleLine = String(value)
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();
  const redacted = redactSecretPatterns(singleLine);
  return capText(redacted, maxBytes).text;
}

function redactSecretPatterns(text) {
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\bghp_[A-Za-z0-9]+\b/g, '[REDACTED]')
    .replace(/\bgho_[A-Za-z0-9]+\b/g, '[REDACTED]')
    .replace(/\bghs_[A-Za-z0-9._-]{36,}/g, '[REDACTED]')
    .replace(/\bghs_[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\bglpat-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\b(GITHUB_TOKEN|GH_TOKEN|GITLAB_TOKEN|GITEA_TOKEN)\b/gi, '[REDACTED]');
}

export function sanitizeUrl(value, maxBytes = DEFAULT_FIELD_MAX_BYTES) {
  if (value == null) return null;
  try {
    const u = new URL(String(value));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.username = '';
    u.password = '';
    return sanitizeField(u.href, maxBytes);
  } catch {
    return null;
  }
}

export async function readStreamCapped(stream, maxBytes = DEFAULT_MAX_BYTES) {
  const chunks = [];
  let total = 0;
  let truncated = false;

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (total + buf.length > maxBytes) {
      const remaining = maxBytes - total;
      if (remaining > 0) chunks.push(buf.subarray(0, remaining));
      truncated = true;
      break;
    }
    chunks.push(buf);
    total += buf.length;
  }

  const combined = Buffer.concat(chunks);
  let end = combined.length;
  while (end > 0 && (combined[end - 1] & 0xc0) === 0x80) end -= 1;
  return { text: combined.subarray(0, end).toString('utf8'), truncated, bytes: end };
}
