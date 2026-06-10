import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi, beforeEach, afterEach } from 'vitest';
import { provider as giteaProvider } from '@remogram/provider-gitea-api';
import { provider as githubProvider } from '@remogram/provider-github-api';
import { provider as gitlabProvider } from '@remogram/provider-gitlab-api';
import { jsonResponse, runProviderContractMatrix } from '../helpers/provider-contract-matrix.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(__dirname, '../fixtures');

function load(providerId, name) {
  return JSON.parse(readFileSync(join(fixturesRoot, providerId, name), 'utf8'));
}

function giteaCase() {
  const ctx = {
    config: {
      provider: 'gitea-api',
      owner: 'attebury',
      repo: 'remogram',
      baseUrl: 'http://localhost:3000',
      remote: 'origin',
    },
    cwd: process.cwd(),
    parsed: { owner: 'attebury', repo: 'remogram', host: 'localhost:3000' },
  };
  return {
    provider: giteaProvider,
    ctx,
    prOpts: { number: 1 },
    useAuth() {
      process.env.GITEA_TOKEN = 'test-token';
    },
    clearAuth() {
      delete process.env.GITEA_TOKEN;
    },
    mockRepoStatus() {
      global.fetch.mockResolvedValueOnce(jsonResponse(load('gitea-api', 'repo.json')));
    },
    mockPrView() {
      global.fetch.mockResolvedValueOnce(jsonResponse(load('gitea-api', 'pull.json')));
    },
    mockPrChecksSuccess() {
      global.fetch
        .mockResolvedValueOnce(jsonResponse(load('gitea-api', 'pull.json')))
        .mockResolvedValueOnce(jsonResponse(load('gitea-api', 'statuses-success.json')));
    },
    mockMergePlanMissingChecks() {
      global.fetch
        .mockResolvedValueOnce(jsonResponse(load('gitea-api', 'pull.json')))
        .mockResolvedValueOnce(jsonResponse(load('gitea-api', 'pull.json')))
        .mockResolvedValueOnce(jsonResponse([]));
    },
  };
}

function githubCase() {
  const ctx = {
    config: {
      provider: 'github-api',
      owner: 'owner',
      repo: 'repo',
      baseUrl: 'https://github.com',
      remote: 'origin',
    },
    cwd: process.cwd(),
    parsed: { owner: 'owner', repo: 'repo', host: 'github.com' },
  };
  return {
    provider: githubProvider,
    ctx,
    prOpts: { number: 42 },
    useAuth() {
      process.env.GITHUB_TOKEN = 'test-token';
    },
    clearAuth() {
      delete process.env.GITHUB_TOKEN;
      delete process.env.GH_TOKEN;
    },
    mockRepoStatus() {
      global.fetch.mockResolvedValueOnce(jsonResponse(load('github-api', 'repo.json')));
    },
    mockPrView() {
      global.fetch.mockResolvedValueOnce(jsonResponse(load('github-api', 'pull-graphql-clean.json')));
    },
    mockPrChecksSuccess() {
      global.fetch
        .mockResolvedValueOnce(jsonResponse(load('github-api', 'pull-graphql-clean.json')))
        .mockResolvedValueOnce(jsonResponse(load('github-api', 'statuses-success.json')))
        .mockResolvedValueOnce(jsonResponse(load('github-api', 'check-runs-success.json')));
    },
    mockMergePlanMissingChecks() {
      global.fetch
        .mockResolvedValueOnce(jsonResponse(load('github-api', 'pull-graphql-clean.json')))
        .mockResolvedValueOnce(jsonResponse(load('github-api', 'pull-graphql-clean.json')))
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse({ check_runs: [] }));
    },
  };
}

function gitlabCase() {
  const ctx = {
    config: {
      provider: 'gitlab-api',
      owner: 'owner',
      repo: 'repo',
      baseUrl: 'https://gitlab.com',
      remote: 'origin',
    },
    cwd: process.cwd(),
    parsed: { owner: 'owner', repo: 'repo', host: 'gitlab.com' },
  };
  return {
    provider: gitlabProvider,
    ctx,
    prOpts: { number: 42 },
    useAuth() {
      process.env.GITLAB_TOKEN = 'test-token';
    },
    clearAuth() {
      delete process.env.GITLAB_TOKEN;
    },
    mockRepoStatus() {
      global.fetch.mockResolvedValueOnce(jsonResponse(load('gitlab-api', 'repo.json')));
    },
    mockPrView() {
      global.fetch.mockResolvedValueOnce(jsonResponse(load('gitlab-api', 'merge-request-clean.json')));
    },
    mockPrChecksSuccess() {
      global.fetch
        .mockResolvedValueOnce(jsonResponse(load('gitlab-api', 'merge-request-clean.json')))
        .mockResolvedValueOnce(jsonResponse(load('gitlab-api', 'statuses-success.json')))
        .mockResolvedValueOnce(jsonResponse(load('gitlab-api', 'pipelines-success.json')));
    },
    mockMergePlanMissingChecks() {
      global.fetch
        .mockResolvedValueOnce(jsonResponse(load('gitlab-api', 'merge-request-clean.json')))
        .mockResolvedValueOnce(jsonResponse(load('gitlab-api', 'merge-request-clean.json')))
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse([]));
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GITEA_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITLAB_TOKEN;
});

runProviderContractMatrix([giteaCase(), githubCase(), gitlabCase()]);
