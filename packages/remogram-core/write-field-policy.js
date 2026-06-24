import { DEFAULT_FIELD_MAX_BYTES } from './caps.js';

export const WRITE_FIELD_MAX_BYTES_ENV = 'REMOGRAM_WRITE_FIELD_MAX_BYTES';
/** Upper bound for undocumented REMOGRAM_WRITE_FIELD_MAX_BYTES debug override. */
export const MAX_WRITE_FIELD_ENV_BYTES = 65536;

const forgeWritePolicySchemaValue = (value) => {
  if (value == null || value === 'none') return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  return undefined;
};

/**
 * @param {object | null | undefined} policyBlock
 * @returns {number | null | undefined} bytes cap, null = uncapped, undefined = unset
 */
export function parseForgeWritePolicyBlock(policyBlock) {
  if (!policyBlock || typeof policyBlock !== 'object') return undefined;
  return forgeWritePolicySchemaValue(policyBlock.field_max_bytes);
}

/**
 * @param {object} repoConfig
 * @param {{ config?: object | null }} operatorLoad
 */
export function resolveEffectiveWriteFieldPolicy(repoConfig, operatorLoad = {}) {
  const repoCap = parseForgeWritePolicyBlock(repoConfig?.forge_write_policy);
  const operatorCap =
    operatorLoad.config != null
      ? parseForgeWritePolicyBlock(operatorLoad.config.forge_write_policy)
      : undefined;

  const envFacts = getEffectiveWriteFieldMaxBytesFromEnv();
  let fieldMaxBytes = DEFAULT_FIELD_MAX_BYTES;
  let source = 'default';

  if (repoCap !== undefined) {
    fieldMaxBytes = repoCap;
    source = 'repo';
  }
  if (operatorCap !== undefined) {
    fieldMaxBytes = operatorCap;
    source = 'operator';
  }
  if (envFacts.envOverride) {
    fieldMaxBytes = envFacts.bytes;
    source = 'env';
  }

  return {
    fieldMaxBytes,
    uncapped: fieldMaxBytes == null,
    source,
    readFieldMaxBytes: DEFAULT_FIELD_MAX_BYTES,
    repoFieldMaxBytes: repoCap,
    operatorFieldMaxBytes: operatorCap,
    envOverride: envFacts.envOverride,
    envClamped: envFacts.clamped ?? false,
    envInvalid: envFacts.invalidEnv ?? false,
  };
}

export function getEffectiveWriteFieldMaxBytesFromEnv() {
  const raw = process.env[WRITE_FIELD_MAX_BYTES_ENV];
  if (raw == null || raw === '') {
    return { bytes: DEFAULT_FIELD_MAX_BYTES, envOverride: false };
  }
  if (raw === '0' || raw === 'none' || raw === 'null') {
    return { bytes: null, envOverride: true };
  }
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { bytes: DEFAULT_FIELD_MAX_BYTES, envOverride: false, invalidEnv: true };
  }
  if (parsed > MAX_WRITE_FIELD_ENV_BYTES) {
    return { bytes: MAX_WRITE_FIELD_ENV_BYTES, envOverride: true, clamped: true };
  }
  return { bytes: parsed, envOverride: true };
}

/** Facts for provider capabilities / doctor packets. */
export function forgeWriteFieldCapabilityFacts(writeFieldPolicy) {
  const policy = writeFieldPolicy ?? resolveEffectiveWriteFieldPolicy({}, {});
  return {
    read_field_max_bytes: policy.readFieldMaxBytes,
    write_field_max_bytes: policy.uncapped ? null : policy.fieldMaxBytes,
    write_field_uncapped: policy.uncapped,
    write_field_policy_source: policy.source,
    ...(policy.envOverride ? { write_field_env_override: true } : {}),
    ...(policy.envClamped ? { write_field_cap_clamped: true } : {}),
    ...(policy.envInvalid ? { write_field_env_invalid: true } : {}),
  };
}
