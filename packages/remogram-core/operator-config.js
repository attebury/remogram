import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { z } from 'zod';
import { writeCommandSchema } from './write-config.js';
import { forgeWritePolicySchema } from './config-schema.js';
import { ERROR_CODES, forgeError } from './contracts/errors.js';
import { normalizedForgeOrigin } from './forge-identity.js';

export const REMOGRAM_OPERATOR_CONFIG_ENV = 'REMOGRAM_OPERATOR_CONFIG';
export const MAX_OPERATOR_CONFIG_BYTES = 8192;

const FORBIDDEN_CONFIG_KEYS = new Set(['token', 'password', 'secret', 'api_key', 'apiKey']);

const repoSegmentSchema = z
  .string()
  .min(1)
  .refine((s) => !/[/%]/.test(s) && !s.includes('..') && !s.includes('/'), {
    message: 'owner/repo must not contain /, .., or %',
  });

const operatorBindSchema = z
  .object({
    provider: z.enum(['gitea-api', 'github-api', 'gitlab-api', 'gitea-tea', 'github-gh']),
    remote: z.string().min(1),
    owner: repoSegmentSchema,
    repo: repoSegmentSchema,
    baseUrl: z.string().url().optional(),
  })
  .strict();

export const operatorConfigSchema = z
  .object({
    version: z.literal('1'),
    bind: operatorBindSchema,
    write_commands: z.array(writeCommandSchema).min(1),
    forge_write_policy: forgeWritePolicySchema.optional(),
  })
  .strict();

function xdgConfigHome() {
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

export function defaultOperatorConfigPath(forgeContext) {
  const { config, parsed } = forgeContext;
  const owner = parsed?.owner ?? config.owner;
  const repo = parsed?.repo ?? config.repo;
  const safeOwner = String(owner).replace(/[^a-zA-Z0-9._-]+/g, '_');
  const safeRepo = String(repo).replace(/[^a-zA-Z0-9._-]+/g, '_');
  const filename = `${config.provider}-${safeOwner}-${safeRepo}.json`;
  return join(xdgConfigHome(), 'remogram', 'operator', filename);
}

export function discoverOperatorConfigPath(options = {}) {
  const cliPath = options.cliPath ?? options.operatorConfigPath ?? null;
  if (cliPath) {
    return { path: cliPath, discovered_via: 'cli_flag' };
  }
  const envPath = process.env[REMOGRAM_OPERATOR_CONFIG_ENV];
  if (envPath) {
    return { path: envPath, discovered_via: 'env' };
  }
  if (options.forgeContext) {
    const defaultPath = defaultOperatorConfigPath(options.forgeContext);
    if (existsSync(defaultPath)) {
      return { path: defaultPath, discovered_via: 'xdg_default' };
    }
  }
  return { path: null, discovered_via: 'none' };
}

function assertForbiddenKeys(obj, pathPrefix = '') {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_CONFIG_KEYS.has(key)) {
      throw new Error(`Forbidden key "${pathPrefix}${key}" in operator config`);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      assertForbiddenKeys(value, `${pathPrefix}${key}.`);
    }
  }
}

function assertPathSafeToRead(configPath) {
  if (!configPath || typeof configPath !== 'string') {
    throw new Error('Operator config path is missing');
  }
  if (configPath.includes('\0')) {
    throw new Error('Operator config path contains invalid characters');
  }
  const expanded = configPath.startsWith('~') ? join(homedir(), configPath.slice(1)) : configPath;
  const absolute = isAbsolute(expanded) ? expanded : resolve(expanded);
  if (!existsSync(absolute)) {
    throw new Error(`Operator config not found: ${configPath}`);
  }
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    throw new Error(`Operator config is not readable: ${configPath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Operator config is not a regular file: ${configPath}`);
  }
  if (stat.size > MAX_OPERATOR_CONFIG_BYTES) {
    throw new Error(`Operator config exceeds ${MAX_OPERATOR_CONFIG_BYTES} bytes`);
  }
  if ((stat.mode & 0o002) !== 0) {
    throw new Error('Operator config is world-writable');
  }
  try {
    realpathSync(absolute);
  } catch {
    throw new Error(`Operator config path could not be resolved: ${configPath}`);
  }
  return absolute;
}

export function parseOperatorConfigFile(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON in operator config');
  }
  assertForbiddenKeys(parsed);
  return operatorConfigSchema.parse(parsed);
}

export function loadOperatorConfigFile(configPath) {
  const absolute = assertPathSafeToRead(configPath);
  const raw = readFileSync(absolute, 'utf8');
  const config = parseOperatorConfigFile(raw);
  return { path: absolute, config };
}

export function assertOperatorBindMatches(operatorConfig, forgeContext, meta = {}) {
  const bind = operatorConfig.bind;
  const { config, parsed } = forgeContext;
  const owner = parsed?.owner ?? config.owner;
  const repo = parsed?.repo ?? config.repo;
  const ctxOrigin = forgeContext.baseUrl ?? normalizedForgeOrigin(config);

  if (bind.provider !== config.provider) {
    throw bindMismatch({
      field: 'provider',
      expected: config.provider,
      actual: bind.provider,
      message: `operator bind provider ${bind.provider} does not match repo config ${config.provider}`,
      meta,
    });
  }
  if (bind.remote !== config.remote) {
    throw bindMismatch({
      field: 'remote',
      expected: config.remote,
      actual: bind.remote,
      message: `operator bind remote ${bind.remote} does not match repo config ${config.remote}`,
      meta,
    });
  }
  if (bind.owner !== owner || bind.repo !== repo) {
    throw bindMismatch({
      field: 'repo',
      expected: `${owner}/${repo}`,
      actual: `${bind.owner}/${bind.repo}`,
      message: `operator bind repo ${bind.owner}/${bind.repo} does not match forge identity ${owner}/${repo}`,
      meta,
    });
  }
  if (bind.baseUrl) {
    const bindOrigin = normalizedForgeOrigin({ baseUrl: bind.baseUrl });
    if (bindOrigin !== ctxOrigin) {
      throw bindMismatch({
        field: 'baseUrl',
        expected: ctxOrigin,
        actual: bindOrigin,
        message: `operator bind baseUrl ${bind.baseUrl} does not match forge baseUrl ${ctxOrigin}`,
        meta,
      });
    }
  }
}

function bindRemediation(meta = {}) {
  const via = meta.discovered_via ?? 'unknown';
  const pathHint = meta.path ? ` at ${meta.path}` : '';
  if (via === 'env') {
    return (
      `Check REMOGRAM_OPERATOR_CONFIG${pathHint}: update bind to match this repo's .remogram.json `
      + 'or unset the env var if the overlay is stale.'
    );
  }
  if (via === 'xdg_default') {
    return (
      `Update the XDG operator overlay${pathHint} bind block to match this repo's .remogram.json `
      + 'or remove the file if it targets a different repository.'
    );
  }
  return (
    `Update operator config bind${pathHint} to match this repo's .remogram.json `
    + '(provider, remote, owner, repo, baseUrl).'
  );
}

function bindMismatch({ field, expected, actual, message, meta = {} }) {
  const remediation = bindRemediation(meta);
  const fullMessage = `${message}. ${remediation}`;
  return Object.assign(new Error(fullMessage), {
    forgeError: forgeError(ERROR_CODES.CONFIG_INVALID, fullMessage, null, {
      reason: 'operator_bind_mismatch',
      field,
      expected,
      actual,
      discovered_via: meta.discovered_via ?? null,
      operator_config_path: meta.path ?? null,
      remediation,
    }),
  });
}

/**
 * @param {{ cliPath?: string | null, forgeContext: object }} options
 * @returns {{ config: object | null, meta: object, error?: object }}
 */
export function loadOperatorConfig(options = {}) {
  const discovery = discoverOperatorConfigPath(options);
  const meta = {
    discovered_via: discovery.discovered_via,
    path: discovery.path ? sanitizePathForEmit(discovery.path) : null,
    bind_ok: null,
  };
  if (!discovery.path) {
    return { config: null, meta, error: null };
  }
  try {
    const loaded = loadOperatorConfigFile(discovery.path);
    assertOperatorBindMatches(loaded.config, options.forgeContext, meta);
    meta.path = sanitizePathForEmit(loaded.path);
    meta.bind_ok = true;
    return { config: loaded.config, meta, error: null };
  } catch (err) {
    meta.bind_ok = false;
    const forgeErr = err.forgeError || forgeError(ERROR_CODES.CONFIG_INVALID, err.message);
    return {
      config: null,
      meta,
      error: forgeErr,
    };
  }
}

function sanitizePathForEmit(configPath) {
  const home = homedir();
  if (configPath.startsWith(home)) {
    return `~${configPath.slice(home.length)}`;
  }
  return configPath;
}
