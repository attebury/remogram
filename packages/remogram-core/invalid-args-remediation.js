function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function commandKey(group, sub) {
  const g = normalizeText(group);
  const s = normalizeText(sub);
  return s ? `${g} ${s}` : g;
}

function remediation(hint, suggestedCommands) {
  return Object.freeze({
    hint,
    suggested_commands: Object.freeze([...suggestedCommands]),
  });
}

const REMEDIATION_MAP = Object.freeze({
  'status set --number': remediation(
    '`status set` writes a commit status and needs a commit SHA, not a PR number.',
    [
      'remogram pr view --number <n> --json',
      'remogram status set --sha <40-char-sha> --context <name> --state <pending|success|failure|error> --json',
    ],
  ),
  'merge execute missing_shas': remediation(
    '`merge execute` is SHA-bound; pass both reviewed base and head SHAs.',
    [
      'remogram pr view --number <n> --json',
      'remogram merge execute --number <n> --expected-base-sha <base-sha> --expected-head-sha <head-sha> --json',
    ],
  ),
  'merge execute missing_number': remediation(
    'Use the forge PR number you reviewed.',
    [
      'remogram cr inventory --json',
      'remogram merge execute --number <n> --expected-base-sha <base-sha> --expected-head-sha <head-sha> --json',
    ],
  ),
  'pr checks missing_selector': remediation(
    'Choose one selector: PR number or git ref.',
    [
      'remogram pr checks --number <n> --json',
      'remogram pr checks --ref <branch-or-sha> --json',
    ],
  ),
  'refs compare missing_refs': remediation(
    'Provide both compare refs.',
    [
      'remogram refs compare --base <ref> --head <ref> --json',
    ],
  ),
  'unknown command': remediation(
    'Use a supported remogram command group/subcommand pair.',
    [
      'remogram --help',
      'remogram doctor --json',
    ],
  ),
});

export function resolveInvalidArgsRemediation({ group, sub, flags = {}, message = '' } = {}) {
  const key = commandKey(group, sub);
  const msg = String(message ?? '');

  if (key === 'status set' && flags.number != null) {
    return REMEDIATION_MAP['status set --number'];
  }
  if (key === 'merge execute') {
    if (!flags.expected_base_sha || !flags.expected_head_sha) {
      return REMEDIATION_MAP['merge execute missing_shas'];
    }
    if (flags.number == null || String(flags.number).trim() === '') {
      return REMEDIATION_MAP['merge execute missing_number'];
    }
  }
  if (key === 'pr checks' && !flags.number && !flags.ref) {
    return REMEDIATION_MAP['pr checks missing_selector'];
  }
  if (key === 'refs compare' && (!flags.base || !flags.head)) {
    return REMEDIATION_MAP['refs compare missing_refs'];
  }
  if (msg.startsWith('Unknown command')) {
    return REMEDIATION_MAP['unknown command'];
  }
  return null;
}

export function withInvalidArgsRemediation(forgeErr, context) {
  if (!forgeErr || forgeErr.code !== 'invalid_args') return forgeErr;
  if (forgeErr.fields?.remediation) return forgeErr;
  const remediationFields = resolveInvalidArgsRemediation(context);
  if (!remediationFields) return forgeErr;
  return {
    ...forgeErr,
    fields: {
      ...(forgeErr.fields ?? {}),
      remediation: remediationFields,
    },
  };
}
