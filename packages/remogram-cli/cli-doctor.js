import {
  loadConfig,
  findConfigPath,
  gitRemoteUrl,
  parseRemoteUrl,
  trustedBaseUrl,
  normalizedForgeOrigin,
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
  resolveMergePolicy,
  ALLOW_MISSING_CHECKS_ENV,
  ALLOW_PENDING_CHECKS_ENV,
  buildWriteReadiness,
  writeReadinessHasWarnings,
  buildApiReachabilityCheck,
  resolveWritePolicyForForge,
  forgeWriteFieldCapabilityFacts,
  resolveEffectiveWriteFieldPolicy,
  loadOperatorConfig,
  WRITE_FIELD_MAX_BYTES_ENV,
  MAX_WRITE_FIELD_ENV_BYTES,
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

function finalizeDoctorPacket(ctx, checks, providerCapabilities, writeConfig = null) {
  const summary = doctorSummary(checks);
  const error =
    summary === 'fail'
      ? forgeError(ERROR_CODES.CONFIG_INVALID, 'Doctor checks failed')
      : null;
  const body = {
    summary,
    checks,
    provider_capabilities: providerCapabilities,
  };
  if (writeConfig) body.write_config = writeConfig;
  return forgePacket(PACKET_TYPES.PROVIDER_DOCTOR, ctx, body, error);
}

export async function buildDoctorPacket(cwd, providers, options = {}) {
  const { live = false, operatorConfigPath = null } = options;
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
      if (config.baseUrl) {
        ctx = { ...ctx, baseUrl: normalizedForgeOrigin(config) };
      }
    }
  }

  if (parsed && loaded) {
    const operatorLoad = loadOperatorConfig({ cliPath: operatorConfigPath, forgeContext: ctx });
    ctx.writeFieldPolicy = resolveEffectiveWriteFieldPolicy(config, operatorLoad);
  }

  if (provider) {
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

  let writeConfig = null;

  if (providerCapabilities) {
    const envNames = providerCapabilities.auth_envs || [];
    const presentEnv = envNames.find((name) => Boolean(process.env[name])) || null;
    const authPresent = Boolean(presentEnv);
    checks.push(
      doctorCheck(
        'auth',
        presentEnv ? 'pass' : 'warn',
        presentEnv ? `${presentEnv} is present` : 'No provider auth environment variable is set',
        { env_names: envNames, present_env: presentEnv },
      ),
    );

    if (providerCapabilities.write_support) {
      const writePolicy = resolveWritePolicyForForge(ctx, { operatorConfigPath });
      writeConfig = buildWriteReadiness(writePolicy, providerCapabilities, { authPresent });
      const warn = writeReadinessHasWarnings(writeConfig);
      const notReady = writeConfig.commands.filter(
        (entry) => entry.provider_supported && !entry.ready,
      );
      const missingConfig = notReady.filter((entry) => !entry.configured).map((entry) => entry.id);
      if (writePolicy.operatorMeta?.discovered_via && writePolicy.operatorMeta.discovered_via !== 'none') {
        if (writePolicy.operatorError) {
          checks.push(
            doctorCheck(
              'operator_config',
              'fail',
              writePolicy.operatorError.message,
              {
                ...writePolicy.operatorMeta,
                ...(writePolicy.operatorError.fields ? { bind_error: writePolicy.operatorError.fields } : {}),
              },
            ),
          );
        } else {
          checks.push(
            doctorCheck(
              'operator_config',
              'pass',
              'Operator write overlay loaded and bound to forge identity',
              writePolicy.operatorMeta,
            ),
          );
        }
      } else {
        checks.push(
          doctorCheck(
            'operator_config',
            'pass',
            'No operator write overlay configured (repo-only write policy)',
            { discovered_via: 'none', path: null, bind_ok: null },
          ),
        );
      }
      checks.push(
        doctorCheck(
          'write_config',
          warn ? 'warn' : 'pass',
          warn
            ? missingConfig.length
              ? `Provider supports write commands but effective write_commands omits: ${missingConfig.join(', ')}. Add ids to .remogram.json or a bound operator config (REMOGRAM_OPERATOR_CONFIG / --operator-config) for Remogram CLI/MCP writes, or use forge/CI tooling for those actions outside Remogram.`
              : writePolicy.operatorError
                ? 'Operator write overlay failed validation; writes are blocked until bind and schema checks pass'
                : 'One or more configured write commands are not ready (check auth or provider support)'
            : 'All provider write commands are configured and ready',
          writeConfig,
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

  const writeFieldFacts = forgeWriteFieldCapabilityFacts(ctx.writeFieldPolicy);
  if (writeFieldFacts.write_field_env_invalid) {
    checks.push(
      doctorCheck(
        'forge_write_field_cap',
        'warn',
        `${WRITE_FIELD_MAX_BYTES_ENV} is invalid; using configured/default write field cap`,
        writeFieldFacts,
      ),
    );
  } else if (writeFieldFacts.write_field_env_override) {
    checks.push(
      doctorCheck(
        'forge_write_field_cap',
        'warn',
        writeFieldFacts.write_field_cap_clamped
          ? `${WRITE_FIELD_MAX_BYTES_ENV} exceeds max ${MAX_WRITE_FIELD_ENV_BYTES}; clamped — agent-safe guarantee is weakened`
          : writeFieldFacts.write_field_uncapped
            ? `${WRITE_FIELD_MAX_BYTES_ENV} disables forge write field cap; agent-safe guarantee is weakened`
            : `${WRITE_FIELD_MAX_BYTES_ENV} overrides forge write field cap; agent-safe guarantee is weakened`,
        writeFieldFacts,
      ),
    );
  } else if (writeFieldFacts.write_field_uncapped) {
    checks.push(
      doctorCheck(
        'forge_write_field_cap',
        'warn',
        'Forge write bodies are uncapped for this binding (read packets remain capped at 512 bytes)',
        writeFieldFacts,
      ),
    );
  } else {
    checks.push(
      doctorCheck(
        'forge_write_field_cap',
        'pass',
        `Forge write field cap is ${writeFieldFacts.write_field_max_bytes} bytes (read cap fixed at 512)`,
        writeFieldFacts,
      ),
    );
  }

  const mergePolicy = resolveMergePolicy(config);
  if (mergePolicy.allow_missing_checks || mergePolicy.allow_pending_checks) {
    checks.push(
      doctorCheck(
        'merge_policy',
        'warn',
        'Merge policy relaxes check blockers for merge plan and merge execute',
        {
          allow_missing_checks: mergePolicy.allow_missing_checks,
          allow_pending_checks: mergePolicy.allow_pending_checks,
          source: mergePolicy.source,
          env_names: [ALLOW_MISSING_CHECKS_ENV, ALLOW_PENDING_CHECKS_ENV],
        },
      ),
    );
  } else {
    checks.push(
      doctorCheck(
        'merge_policy',
        'pass',
        'Default merge policy — missing and pending checks block merge',
        {
          allow_missing_checks: false,
          allow_pending_checks: false,
          source: mergePolicy.source,
        },
      ),
    );
  }

  const hostBindingPass = checks.some(
    (check) => check.name === 'host_binding' && check.status === 'pass',
  );
  const configPass = checks.some((check) => check.name === 'config' && check.status === 'pass');
  checks.push(
    await buildApiReachabilityCheck(ctx, provider, {
      live,
      prerequisitesPass: live && configPass && hostBindingPass && parsed != null,
    }),
  );

  return finalizeDoctorPacket(ctx, checks, providerCapabilities, writeConfig);
}
