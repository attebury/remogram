import {
  loadConfig,
  findConfigPath,
  assertForgeReady,
  gitRemoteUrl,
  parseRemoteUrl,
  trustedBaseUrl,
  assertConfigMatchesRemote,
  forgeContext,
  forgePacket,
  forgeErrorPacket,
  unknownForgeContext,
  PACKET_TYPES,
  ERROR_CODES,
  forgeError,
  sanitizeField,
  assertGitRef,
  assertGitRemote,
  getEffectiveIngestMaxBytes,
  FORGE_INGEST_MAX_BYTES_ENV,
  throwIfStaleHeadByNumber,
  FACT_INVENTORY_PACKET_TYPES,
  forgeFactInventoryPacket,
  assertWriteCommandConfigured,
} from '@remogram/core';
import { provider as giteaApi } from '@remogram/provider-gitea-api';
import { provider as githubApi } from '@remogram/provider-github-api';
import { provider as gitlabApi } from '@remogram/provider-gitlab-api';
import { provider as giteaTea } from '@remogram/provider-gitea-tea';
import { provider as githubGh } from '@remogram/provider-github-gh';

const PROVIDERS = {
  'gitea-api': giteaApi,
  'github-api': githubApi,
  'gitlab-api': gitlabApi,
  'gitea-tea': giteaTea,
  'github-gh': githubGh,
};

const REPEATABLE_FLAGS = new Set(['allowed_path']);

function parseAllowedPathFlags(flags) {
  if (flags.allowed_path == null) return undefined;
  return Array.isArray(flags.allowed_path) ? flags.allowed_path : [flags.allowed_path];
}

function parsePositiveInt(value, name) {
  if (value == null) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw Object.assign(new Error(`Invalid ${name}`), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, `${name} must be a positive integer`),
    });
  }
  return n;
}

function output(packet, asJson) {
  console.log(JSON.stringify(packet, null, asJson ? 2 : 0));
}

function handleError(err, ctx, asJson) {
  const fe = err.forgeError || {
    code: ERROR_CODES.API_ERROR,
    message: err.message,
    status: err.status,
  };
  const baseCtx = ctx || {
    providerId: 'unknown',
    remoteName: 'origin',
    repoId: 'unknown/unknown',
  };
  if (err.staleHeadPacket) {
    output(forgePacket(err.staleHeadPacket.type, baseCtx, err.staleHeadPacket.body, fe), asJson);
    process.exitCode = 1;
    return;
  }
  output(forgeErrorPacket(baseCtx, fe), asJson);
  process.exitCode = 1;
}

function doctorCheck(name, status, message, details = null) {
  return {
    name,
    status,
    message: sanitizeField(message),
    ...(details ? { details } : {}),
  };
}

function doctorSummary(checks) {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  return 'pass';
}

function contextFromConfig(config, cwd, parsed = null) {
  return {
    providerId: config.provider,
    remoteName: config.remote,
    repoId: parsed ? `${parsed.owner}/${parsed.repo}` : `${config.owner}/${config.repo}`,
    config,
    cwd,
    parsed,
  };
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

async function buildDoctorPacket(cwd, providers) {
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

  let remoteUrl = null;
  try {
    assertGitRemote(config.remote, 'config.remote');
    remoteUrl = gitRemoteUrl(loaded.cwd, config.remote);
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
            ? `Provider supports write commands but .remogram.json write_commands omits: ${missing.join(', ')}`
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

  const { bytes: ingestCapBytes, envOverride: ingestEnvOverride, invalidEnv: ingestInvalidEnv } =
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
        `${FORGE_INGEST_MAX_BYTES_ENV} overrides default ingest cap; agent-safe guarantee is weakened`,
        { effective_bytes: ingestCapBytes, env_override: true },
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

export async function runCli(argv, options = {}) {
  const cwd = options.cwd ?? process.env.REMOGRAM_CWD ?? process.cwd();
  const providers = options.providers ?? PROVIDERS;
  const positional = [];
  let asJson = false;
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') asJson = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-/g, '_');
      const next = argv[i + 1];
      if (REPEATABLE_FLAGS.has(key)) {
        if (!flags[key]) flags[key] = [];
        if (next != null && !next.startsWith('--')) {
          flags[key].push(next);
          i += 1;
        }
      } else if (next != null && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  const [group, sub] = positional;

  if (group === 'doctor' && sub == null) {
    const packet = await buildDoctorPacket(cwd, providers);
    output(packet, asJson);
    if (!packet.ok) process.exitCode = 1;
    return;
  }

  let ctx;
  try {
    const loaded = assertForgeReady(loadConfig(cwd));
    ctx = forgeContext(loaded);
  } catch (err) {
    handleError(err, null, asJson);
    return;
  }

  const provider = providers[ctx.config.provider];
  if (!provider) {
    handleError(
      {
        message: `Unsupported provider: ${ctx.config.provider}`,
        forgeError: forgeError(
          ERROR_CODES.PROVIDER_UNSUPPORTED,
          `Unsupported provider: ${ctx.config.provider}`,
        ),
      },
      ctx,
      asJson,
    );
    return;
  }

  try {
    let packet;
    if (group === 'provider' && sub === 'capabilities') {
      packet = forgePacket(
        PACKET_TYPES.PROVIDER_CAPABILITIES,
        ctx,
        await provider.providerCapabilities(ctx),
      );
    } else if (group === 'repo' && sub === 'status') {
      packet = forgePacket(PACKET_TYPES.REPO_STATUS, ctx, await provider.repoStatus(ctx));
    } else if (group === 'refs' && sub === 'compare') {
      if (!flags.base || !flags.head) {
        throw Object.assign(new Error('--base and --head required'), {
          forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--base and --head required'),
        });
      }
      assertGitRef(flags.base, '--base');
      assertGitRef(flags.head, '--head');
      packet = forgePacket(
        PACKET_TYPES.REF_COMPARE,
        ctx,
        await provider.refsCompare(ctx, flags.base, flags.head),
      );
    } else if (group === 'refs' && sub === 'inventory') {
      if (typeof provider.refsInventory !== 'function') {
        throw Object.assign(new Error('refs inventory not implemented for provider'), {
          forgeError: forgeError(
            ERROR_CODES.PROVIDER_UNSUPPORTED,
            'refs inventory not implemented for provider',
          ),
        });
      }
      packet = forgeFactInventoryPacket(
        FACT_INVENTORY_PACKET_TYPES.REF_INVENTORY,
        ctx,
        await provider.refsInventory(ctx),
      );
    } else if (group === 'cr' && sub === 'inventory') {
      if (typeof provider.crInventory !== 'function') {
        throw Object.assign(new Error('cr inventory not implemented for provider'), {
          forgeError: forgeError(
            ERROR_CODES.PROVIDER_UNSUPPORTED,
            'cr inventory not implemented for provider',
          ),
        });
      }
      const inventoryBody = await provider.crInventory(ctx, {
          slice_ref: flags.slice_ref,
          limit: parsePositiveInt(flags.limit, '--limit'),
        });
      if (inventoryBody.list_truncated === true) {
        throw Object.assign(new Error('Open CR list incomplete'), {
          forgeError: forgeError(
            ERROR_CODES.INVENTORY_LIST_INCOMPLETE,
            'Open change request list could not be proved complete within pagination bounds',
            null,
            {
              inventory_list: {
                entry_count: inventoryBody.entry_count,
              },
            },
          ),
        });
      }
      packet = forgeFactInventoryPacket(
        FACT_INVENTORY_PACKET_TYPES.CR_INVENTORY_SLICE,
        ctx,
        inventoryBody,
      );
    } else if (group === 'cr' && sub === 'open') {
      if (typeof provider.crOpen !== 'function') {
        throw Object.assign(new Error('cr open not implemented for provider'), {
          forgeError: forgeError(
            ERROR_CODES.PROVIDER_UNSUPPORTED,
            'cr open not implemented for provider',
          ),
        });
      }
      if (!flags.head || !flags.base || !flags.title) {
        throw Object.assign(new Error('--head, --base, and --title required'), {
          forgeError: forgeError(
            ERROR_CODES.INVALID_ARGS,
            '--head, --base, and --title required for cr open',
          ),
        });
      }
      assertGitRef(flags.head, '--head');
      assertGitRef(flags.base, '--base');
      assertWriteCommandConfigured(ctx.config, 'cr_open');
      packet = forgePacket(
        PACKET_TYPES.CHANGE_REQUEST_OPENED,
        ctx,
        await provider.crOpen(ctx, {
          head: flags.head,
          base: flags.base,
          title: flags.title,
          body: flags.body,
        }),
      );
    } else if (group === 'pr' && sub === 'view') {
      const number = parsePositiveInt(flags.number, '--number');
      if (number == null) {
        throw Object.assign(new Error('--number required'), {
          forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--number required for pr view'),
        });
      }
      const body = await provider.prView(ctx, { number });
      throwIfStaleHeadByNumber(
        ctx,
        PACKET_TYPES.PR_STATUS,
        body,
        body.head_ref,
        body.head_sha,
      );
      packet = forgePacket(PACKET_TYPES.PR_STATUS, ctx, body);
    } else if (group === 'pr' && sub === 'checks') {
      const number = parsePositiveInt(flags.number, '--number');
      if (number == null && !flags.ref) {
        throw Object.assign(new Error('--number or --ref required'), {
          forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--number or --ref required for pr checks'),
        });
      }
      if (flags.ref) assertGitRef(flags.ref, '--ref');
      if (number != null && !flags.ref) {
        const view = await provider.prView(ctx, { number });
        throwIfStaleHeadByNumber(
          ctx,
          PACKET_TYPES.PR_CHECKS,
          { head_sha: view.head_sha },
          view.head_ref,
          view.head_sha,
        );
      }
      packet = forgePacket(
        PACKET_TYPES.PR_CHECKS,
        ctx,
        await provider.prChecks(ctx, { number, ref: flags.ref }),
      );
    } else if (group === 'merge' && sub === 'plan') {
      const number = parsePositiveInt(flags.number, '--number');
      if (number == null) {
        throw Object.assign(new Error('--number required'), {
          forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--number required for merge plan'),
        });
      }
      const allowedPaths = parseAllowedPathFlags(flags);
      packet = forgePacket(
        PACKET_TYPES.MERGE_PLAN,
        ctx,
        await provider.mergePlan(ctx, {
          number,
          ...(allowedPaths ? { allowed_paths: allowedPaths } : {}),
        }),
      );
    } else if (group === 'sync' && sub === 'plan') {
      const remote = flags.remote || ctx.config.remote;
      assertGitRemote(remote, '--remote');
      packet = forgePacket(
        PACKET_TYPES.SYNC_PLAN,
        ctx,
        await provider.syncPlan(ctx, remote),
      );
    } else {
      throw Object.assign(new Error(`Unknown command: ${positional.join(' ')}`), {
        forgeError: forgeError(
          ERROR_CODES.INVALID_ARGS,
          'Unknown command. Try: provider capabilities, repo status, refs compare, refs inventory, cr inventory, cr open, pr view, pr checks, merge plan, sync plan',
        ),
      });
    }
    output(packet, asJson);
  } catch (err) {
    handleError(err, ctx, asJson);
  }
}
