import { DEFAULT_MAX_BYTES } from '@remogram/core';

/** UTF-8 byte length of JSON.stringify(value). */
export function byteSize(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function tokenEstimate(bytes) {
  return Math.ceil(bytes / 4);
}

function sizeMetrics(bytes) {
  return { bytes, token_estimate: tokenEstimate(bytes) };
}

function ratio(remogramBytes, baselineBytes) {
  if (!baselineBytes) return null;
  return Math.round((remogramBytes / baselineBytes) * 1000) / 1000;
}

/**
 * Build a sizes-only compare report (no raw forge or packet bodies).
 * @param {{ providerId: string, prNumber: number, remogramPacket: object, baselines: Record<string, { bytes?: number, label?: string, truncated?: boolean, error?: string }>, capBytes?: number }} input
 */
export function compareReport({
  providerId,
  prNumber,
  remogramPacket,
  baselines,
  capBytes = DEFAULT_MAX_BYTES,
}) {
  const remogramBytes = byteSize(remogramPacket);
  const report = {
    schema_version: '1',
    command: 'pr_view',
    provider_id: providerId,
    pr_number: prNumber,
    remogram_ingest_cap_bytes: capBytes,
    remogram_packet: sizeMetrics(remogramBytes),
    baselines: {},
    ratios: {},
  };

  for (const [key, baseline] of Object.entries(baselines)) {
    if (baseline.error) {
      report.baselines[key] = { error: baseline.error };
      continue;
    }

    const entry = {
      bytes: baseline.bytes,
      token_estimate: tokenEstimate(baseline.bytes),
    };
    if (baseline.label) entry.label = baseline.label;
    if (baseline.truncated) entry.truncated = true;
    if (baseline.bytes > capBytes) entry.exceeds_ingest_cap = true;

    report.baselines[key] = entry;
    report.ratios[`vs_${key}`] = ratio(remogramBytes, baseline.bytes);
  }

  return report;
}

export function formatCompareSummary(report) {
  const lines = [
    `pr_view payload compare (${report.provider_id}, PR #${report.pr_number})`,
    `  remogram packet: ${report.remogram_packet.bytes} bytes (~${report.remogram_packet.token_estimate} tokens)`,
    `  ingest cap: ${report.remogram_ingest_cap_bytes} bytes`,
  ];

  for (const [key, baseline] of Object.entries(report.baselines)) {
    if (baseline.error) {
      lines.push(`  ${key}: skipped (${baseline.error})`);
      continue;
    }
    const capNote = baseline.exceeds_ingest_cap ? ' [exceeds ingest cap]' : '';
    const truncNote = baseline.truncated ? ' [truncated at sidecar read cap]' : '';
    const ratio = report.ratios[`vs_${key}`];
    const ratioNote = ratio != null ? ` ratio=${ratio}` : '';
    lines.push(
      `  ${key}: ${baseline.bytes} bytes (~${baseline.token_estimate} tokens)${capNote}${truncNote}${ratioNote}`,
    );
  }

  return lines.join('\n');
}
