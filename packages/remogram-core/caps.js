export const DEFAULT_MAX_BYTES = 8192;
export const DEFAULT_FIELD_MAX_BYTES = 512;
export const FORGE_INGEST_MAX_BYTES_ENV = 'REMOGRAM_FORGE_INGEST_MAX_BYTES';

export function getEffectiveIngestMaxBytes() {
  const raw = process.env[FORGE_INGEST_MAX_BYTES_ENV];
  if (raw == null || raw === '') {
    return { bytes: DEFAULT_MAX_BYTES, envOverride: false };
  }
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { bytes: DEFAULT_MAX_BYTES, envOverride: false, invalidEnv: true };
  }
  return { bytes: parsed, envOverride: true };
}

/** Facts for provider capabilities packets (forge ingest policy). */
export function forgeIngestCapabilityFacts() {
  const { bytes } = getEffectiveIngestMaxBytes();
  return { forge_ingest_cap_bytes: bytes };
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
  return capText(singleLine, maxBytes).text;
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
