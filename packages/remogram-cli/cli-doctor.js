import {
  loadConfig,
  findConfigPath,
  gitRemoteUrl,
  parseRemoteUrl,
  trustedBaseUrl,
  assertConfigMatchesRemote,
  forgePacket,
  unknownForgeContext,
  PACKET_TYPES,
  ERROR_CODES,
  forgeError,
  sanitizeField,
  assertGitRemote,
  getEffectiveIngestMaxBytes,
  FORGE_INGEST_MAX_BYTES_ENV,
  MAX_FORGE_INGEST_ENV_BYTES,
} from '@remogram/core';
import { contextFromConfig } from './cli-io.js';

export function doctorCheck(name, status, message, details = null) {
  return {
    name,
    status,
    message: sanitizeField(message),
    ...(details ? { details } : {}),
  };
}

export function doctorSummary(checks) {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  return 'pass';
}

function finalizeDoctorPacket(ctx, checks, providerCapabilities) {
  const summary = doctorSummary(checks);
  const error =
    summary === 'fail'
      ? forgeError(ERROR_CODES.CONFIG_INVALID, 'Doctor checks failed')
      : null;
  return forgePacket(
    PACKET_TYPES.PROVIDER_DOCTOR,
    ctx,
    {
      summary,
      checks,
      provider_capabilities: providerCapabilities,
    },
    error,
  );
}

export async function buildDoctorPacket(cwd, providers) {
  const checks = [];
  const configPath = findConfigPath(cwd);
  let loaded = null;
  let config = null;
  let parsed = null;
  let ctx = unknownForgeContext();
  let providerCapabilities = null;

  if (!configPath) {
    checks.push(doctorCheck('config', 'fail', 'No .remogram.json found'));
    return finalizeDoctorPacket(ctx, checks, null);
  }

  try {
    loaded = loadConfig(cwd);
    config = loaded.config;
    ctx = contextFromConfig(config, loaded.cwd);
    checks.push(doctorCheck('config', 'pass', '.remogram.json is present and valid'));
  } catch (err) {
    checks.push(doctorCheck('config', 'fail', err.forgeError?.message || err.message));
    return finalizeDoctorPacket(ctx, checks, null);
  }

  const provider = providers[config.provider];
  if (!provider) {
    checks.push(doctorCheck('provider', 'fail', `Unsupported provider: ${config.provider}`));
  } else {
    if (typeof provider.providerCapabilities === 'function') {
      providerCapabilities = await provider.providerCapabilities(ctx);
      const stubProvider =
        providerCapabilities.commands?.length > 0
        && providerCapabilities.commands.every((command) => command.implemented === false);
      checks.push(
        doctorCheck(
          'provider',
          stubProvider ? 'warn' : 'pass',
          stubProvider
            ? `${config.provider} is not fully supported in v1; use an *-api provider`
            : `${config.provider} is registered`,
        ),
      );
      checks.push(doctorCheck('capabilities', 'pass', 'Provider capabilities are available'));
    } else {
      checks.push(doctorCheck('provider', 'pass', `${config.provider} is registered`));
      checks.push(doctorCheck('capabilities', 'fail', 'Provider capabilities are not implemented'));
    }
  }

  try {
    assertGitRemote(config.remote, 'config.remote');
    const remoteUrl = gitRemoteUrl(loaded.cwd, config.remote);
    parsed = parseRemoteUrl(remoteUrl);
    if (!parsed) {
      checks.push(doctorCheck('remote', 'fail', 'Could not parse git remote URL'));
    } else {
      ctx = contextFromConfig(config, loaded.cwd, parsed);
      checks.push(doctorCheck('remote', 'pass', 'Git remote URL parses successfully', {
        host: sanitizeField(parsed.host),
        owner: sanitizeField(parsed.owner),
        repo: sanitizeField(parsed.repo),
      }));
    }
  } catch (err) {
    checks.push(doctorCheck('remote', 'fail', err.forgeError?.message || err.message));
  }

  if (parsed) {
    try {
      assertConfigMatchesRemote(config, parsed);
      checks.push(doctorCheck('repo_match', 'pass', 'Config owner/repo matches git remote'));
    } catch (err) {
      checks.push(doctorCheck('repo_match', 'fail', err.forgeError?.message || err.message));
    }

    if (config.baseUrl && !trustedBaseUrl(config, parsed.host)) {
      checks.push(
        doctorCheck('host_binding', 'fail', `baseUrl host does not match remote host ${parsed.host}`),
      );
    } else {
      checks.push(doctorCheck('host_binding', 'pass', 'Configured host binding is trusted'));
    }
  }

  if (providerCapabilities) {
    const envNames = providerCapabilities.auth_envs || [];
    const presentEnv = envNames.find((name) => Boolean(process.env[name])) || null;
    checks.push(
      doctorCheck(
        'auth',
        presentEnv ? 'pass' : 'warn',
        presentEnv ? `${presentEnv} is present` : 'No provider auth environment variable is set',
        { env_names: envNames, present_env: presentEnv },
      ),
    );

    if (providerCapabilities.write_support) {
      const providerWrites = (providerCapabilities.write_commands || []).filter(Boolean);
      const configuredWrites = Array.isArray(config?.write_commands) ? config.write_commands : [];
      const missing = providerWrites.filter((name) => !configuredWrites.includes(name));
      checks.push(
        doctorCheck(
          'write_config',
          missing.length ? 'warn' : 'pass',
          missing.length
            ? `Provider supports write commands but .remogram.json write_commands omits: ${missing.join(', ')}. Add ids for Remogram CLI/MCP writes, or use forge/CI tooling for those actions outside Remogram.`
            : 'Consumer write_commands matches provider write surface',
          { provider_write_commands: providerWrites, configured_write_commands: configuredWrites },
        ),
      );
    }

    if (!providerCapabilities.check_sources?.length) {
      checks.push(doctorCheck('checks', 'warn', 'Provider does not report forge check sources'));
    } else {
      checks.push(doctorCheck('checks', 'pass', 'Provider reports forge check sources', {
        sources: providerCapabilities.check_sources,
      }));
    }
  }

  const { bytes: ingestCapBytes, envOverride: ingestEnvOverride, invalidEnv: ingestInvalidEnv, clamped: ingestClamped } =
    getEffectiveIngestMaxBytes();
  if (ingestInvalidEnv) {
    checks.push(
      doctorCheck(
        'forge_ingest_cap',
        'warn',
        `${FORGE_INGEST_MAX_BYTES_ENV} is invalid; using default 8192 bytes`,
        { effective_bytes: ingestCapBytes, env_override: false },
      ),
    );
  } else if (ingestEnvOverride) {
    checks.push(
      doctorCheck(
        'forge_ingest_cap',
        'warn',
        ingestClamped
          ? `${FORGE_INGEST_MAX_BYTES_ENV} exceeds max ${MAX_FORGE_INGEST_ENV_BYTES}; clamped — agent-safe guarantee is weakened`
          : `${FORGE_INGEST_MAX_BYTES_ENV} overrides default ingest cap; agent-safe guarantee is weakened`,
        { effective_bytes: ingestCapBytes, env_override: true, ...(ingestClamped ? { clamped: true } : {}) },
      ),
    );
  } else {
    checks.push(
      doctorCheck(
        'forge_ingest_cap',
        'pass',
        'Forge HTTP ingest cap is default 8192 bytes',
        { effective_bytes: ingestCapBytes, env_override: false },
      ),
    );
  }

  checks.push(doctorCheck('api_reachability', 'skipped', 'Live API reachability is not checked by default'));

  return finalizeDoctorPacket(ctx, checks, providerCapabilities);
}
