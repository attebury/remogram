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

/** Baseline for ref_compare on API providers (local git only; no forge HTTP ingest). */
export function localGitOnlyBaseline() {
  return {
    local_git_only: {
      bytes: 0,
      token_estimate: 0,
      label: 'no_forge_http_ingest',
      note: 'API providers resolve refs via local git; no forge HTTP body to measure for ref_compare.',
    },
  };
}

/**
 * Build a sizes-only compare report (no raw forge or packet bodies).
 * @param {{
 *   command: 'pr_view' | 'pr_checks' | 'ref_compare',
 *   providerId: string,
 *   remogramPacket: object,
 *   baselines: Record<string, { bytes?: number, label?: string, truncated?: boolean, error?: string, note?: string }>,
 *   capBytes?: number,
 *   prNumber?: number,
 *   baseRef?: string,
 *   headRef?: string,
 * }} input
 */
export function compareReport({
  command,
  providerId,
  remogramPacket,
  baselines,
  capBytes = DEFAULT_MAX_BYTES,
  prNumber,
  baseRef,
  headRef,
}) {
  const remogramBytes = byteSize(remogramPacket);
  const report = {
    schema_version: '1',
    command,
    provider_id: providerId,
    remogram_ingest_cap_bytes: capBytes,
    remogram_packet: sizeMetrics(remogramBytes),
    baselines: {},
    ratios: {},
  };

  if (prNumber != null) report.pr_number = prNumber;
  if (baseRef != null) {
    if (command === 'ref_compare') report.compare_base_ref = baseRef;
    else report.forge_target_branch_ref = baseRef;
  }
  if (headRef != null) {
    if (command === 'ref_compare') report.compare_head_ref = headRef;
    else report.forge_source_branch_ref = headRef;
  }

  for (const [key, baseline] of Object.entries(baselines)) {
    if (baseline.error) {
      report.baselines[key] = { error: baseline.error };
      continue;
    }

    const entry = {
      bytes: baseline.bytes,
      token_estimate: tokenEstimate(baseline.bytes ?? 0),
    };
    if (baseline.label) entry.label = baseline.label;
    if (baseline.note) entry.note = baseline.note;
    if (baseline.truncated) entry.truncated = true;
    if (baseline.bytes > capBytes) entry.exceeds_ingest_cap = true;

    report.baselines[key] = entry;
    if (baseline.bytes > 0) {
      report.ratios[`vs_${key}`] = ratio(remogramBytes, baseline.bytes);
    }
  }

  return report;
}

function reportTitle(report) {
  if (report.command === 'ref_compare') {
    return `ref_compare payload compare (${report.provider_id}, ${report.compare_base_ref}..${report.compare_head_ref})`;
  }
  if (report.command === 'pr_checks') {
    return `pr_checks payload compare (${report.provider_id}, PR #${report.pr_number})`;
  }
  return `pr_view payload compare (${report.provider_id}, PR #${report.pr_number})`;
}

export function formatCompareSummary(report) {
  const lines = [
    reportTitle(report),
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
    const ratioVal = report.ratios[`vs_${key}`];
    const ratioNote = ratioVal != null ? ` ratio=${ratioVal}` : '';
    const note = baseline.note ? ` (${baseline.note})` : '';
    lines.push(
      `  ${key}: ${baseline.bytes} bytes (~${baseline.token_estimate} tokens)${capNote}${truncNote}${ratioNote}${note}`,
    );
  }

  return lines.join('\n');
}
