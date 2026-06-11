import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseConfigFile } from './config-schema.js';
import { ERROR_CODES, forgeError } from './contracts/errors.js';
import { assertGitRemote } from './git-args.js';

const HOST_ALIASES = new Map([
  ['localhost:3000', '127.0.0.1:3000'],
  ['127.0.0.1:3000', 'localhost:3000'],
]);

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
  assertGitRemote(remote);
  try {
    return execFileSync('git', ['remote', 'get-url', remote], {
      cwd,
      encoding: 'utf8',
      timeout: 10_000,
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

function hostsEquivalent(a, b) {
  if (a === b) return true;
  return HOST_ALIASES.get(a) === b || HOST_ALIASES.get(b) === a;
}

export function trustedBaseUrl(config, remoteHost) {
  if (!config.baseUrl) return true;
  let configHost;
  try {
    configHost = new URL(config.baseUrl).host;
  } catch {
    return false;
  }
  return configHost === remoteHost || hostsEquivalent(configHost, remoteHost);
}

export function assertConfigMatchesRemote(config, parsed) {
  if (config.owner !== parsed.owner || config.repo !== parsed.repo) {
    throw Object.assign(new Error('Config owner/repo does not match git remote'), {
      forgeError: forgeError(
        ERROR_CODES.CONFIG_INVALID,
        `Config repo ${config.owner}/${config.repo} does not match remote ${parsed.owner}/${parsed.repo}`,
      ),
    });
  }
}

export function assertForgeReady(loaded) {
  const { config, cwd } = loaded;
  assertGitRemote(config.remote, 'config.remote');
  const remoteUrl = gitRemoteUrl(cwd, config.remote);
  const parsed = parseRemoteUrl(remoteUrl);
  if (!parsed) {
    throw Object.assign(new Error('Could not parse git remote'), {
      forgeError: forgeError(ERROR_CODES.REMOTE_INFER_FAILED, 'Could not parse git remote URL'),
    });
  }
  assertConfigMatchesRemote(config, parsed);
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
    repoId: `${parsed.owner}/${parsed.repo}`,
    config,
    cwd: loaded.cwd,
    parsed,
  };
}
