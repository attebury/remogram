import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseConfigFile } from './config-schema.js';
import { ERROR_CODES, forgeError } from './contracts/errors.js';

export function findConfigPath(startDir = process.cwd()) {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, '.remogram.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadConfig(cwd = process.cwd()) {
  const path = findConfigPath(cwd);
  if (!path) {
    throw Object.assign(new Error('No .remogram.json found'), {
      forgeError: forgeError(ERROR_CODES.CONFIG_NOT_FOUND, 'No .remogram.json found'),
    });
  }
  try {
    const raw = readFileSync(path, 'utf8');
    return { path, config: parseConfigFile(raw), cwd: dirname(path) };
  } catch (err) {
    throw Object.assign(new Error(err.message), {
      forgeError: forgeError(ERROR_CODES.CONFIG_INVALID, err.message),
    });
  }
}

export function gitRemoteUrl(cwd, remote = 'origin') {
  try {
    return execFileSync('git', ['remote', 'get-url', remote], {
      cwd,
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

export function parseRemoteUrl(url) {
  if (!url) return null;
  const ssh = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (ssh) {
    const [, host, path] = ssh;
    const parts = path.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const repo = parts.pop();
    const owner = parts.join('/');
    return { host, owner, repo };
  }
  try {
    const u = new URL(url.replace(/\.git$/, ''));
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const repo = parts.pop();
    const owner = parts.join('/');
    return { host: u.host, owner, repo, protocol: u.protocol };
  } catch {
    return null;
  }
}

export function trustedBaseUrl(config, remoteHost) {
  if (!config.baseUrl) return true;
  let configHost;
  try {
    configHost = new URL(config.baseUrl).host;
  } catch {
    return false;
  }
  if (configHost === remoteHost) return true;
  return (config.trustedHosts ?? []).some((entry) => {
    const normalized = entry.includes('://') ? new URL(entry).host : entry;
    return normalized === remoteHost || normalized === configHost;
  });
}

export function assertForgeReady(loaded) {
  const { config, cwd } = loaded;
  const remoteUrl = gitRemoteUrl(cwd, config.remote);
  const parsed = parseRemoteUrl(remoteUrl);
  if (!parsed) {
    throw Object.assign(new Error('Could not parse git remote'), {
      forgeError: forgeError(ERROR_CODES.REMOTE_INFER_FAILED, 'Could not parse git remote URL'),
    });
  }
  if (config.baseUrl && !trustedBaseUrl(config, parsed.host)) {
    throw Object.assign(new Error('baseUrl host not trusted'), {
      forgeError: forgeError(
        ERROR_CODES.UNTRUSTED_BASE_URL,
        `baseUrl host does not match remote host ${parsed.host}`,
      ),
    });
  }
  return { ...loaded, remoteUrl, parsed };
}

export function forgeContext(loaded) {
  const { config, parsed } = loaded;
  return {
    providerId: config.provider,
    remoteName: config.remote,
    repoId: `${config.owner}/${config.repo}`,
    config,
    cwd: loaded.cwd,
    parsed,
  };
}
