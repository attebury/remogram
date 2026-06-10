/**
 * Smoke-only forge HTTP fetches for pr_view baseline byte measurement.
 * Uses a read cap separate from production fetchJson (8KB). Never persists response bodies.
 */
import { assertForgeReady, loadConfig, readStreamCapped } from '@remogram/core';
import {
  apiBase as githubApiBase,
  authHeaders as githubAuthHeaders,
  githubToken,
  graphqlEndpoint,
  repoApiPath as githubRepoApiPath,
} from '@remogram/provider-github-api';
import {
  apiBase as giteaApiBase,
  authHeaders as giteaAuthHeaders,
  giteaToken,
  repoApiPath as giteaRepoApiPath,
} from '@remogram/provider-gitea-api';
import {
  apiBase as gitlabApiBase,
  authHeaders as gitlabAuthHeaders,
  gitlabToken,
  projectApiPath,
} from '@remogram/provider-gitlab-api';

/** Same field selection as packages/provider-github-api/index.js PR_VIEW_QUERY */
const PR_VIEW_QUERY = `
query RemogramPrView($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number
      url
      title
      state
      mergeable
      mergeStateStatus
      baseRefName
      baseRefOid
      headRefName
      headRefOid
    }
  }
}
`;

export const SMOKE_SIDECAR_MAX_BYTES = 256 * 1024;

export function loadSmokeForgeContext(cwd = process.cwd()) {
  const ready = assertForgeReady(loadConfig(cwd));
  return {
    config: ready.config,
    parsed: ready.parsed,
    cwd: ready.cwd,
    providerId: ready.config.provider,
  };
}

async function fetchBodyBytes(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers, body, redirect: 'error' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  }
  const { bytes, truncated } = await readStreamCapped(res.body, SMOKE_SIDECAR_MAX_BYTES);
  return { bytes, truncated };
}

async function measureGet(url, headers) {
  return fetchBodyBytes(url, { headers });
}

async function measurePostJson(url, headers, payload) {
  return fetchBodyBytes(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function githubSidecar(config, parsed, prNumber) {
  const auth = githubToken();
  if (!auth.token) {
    return {
      provider_path: { error: 'GITHUB_TOKEN or GH_TOKEN not set' },
      github_rest_pull: { error: 'GITHUB_TOKEN or GH_TOKEN not set' },
    };
  }

  const headers = githubAuthHeaders(auth.token);
  const baselines = {};

  try {
    const graphqlUrl = graphqlEndpoint(config, parsed);
    const graphqlBody = {
      query: PR_VIEW_QUERY,
      variables: { owner: config.owner, repo: config.repo, number: prNumber },
    };
    const graphql = await measurePostJson(graphqlUrl, headers, graphqlBody);
    baselines.provider_path = {
      ...graphql,
      label: 'github_graphql_response',
    };
  } catch (err) {
    baselines.provider_path = {
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const restUrl = `${githubApiBase(config, parsed)}${githubRepoApiPath(config, 'pulls', prNumber)}`;
    const rest = await measureGet(restUrl, headers);
    baselines.github_rest_pull = rest;
  } catch (err) {
    baselines.github_rest_pull = {
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return baselines;
}

async function giteaSidecar(config, parsed, prNumber) {
  const token = giteaToken();
  if (!token) {
    return { provider_path: { error: 'GITEA_TOKEN not set' } };
  }

  try {
    const url = `${giteaApiBase(config, parsed)}${giteaRepoApiPath(config, 'pulls', prNumber)}`;
    const measured = await measureGet(url, giteaAuthHeaders(token));
    return { provider_path: { ...measured, label: 'gitea_rest_pull' } };
  } catch (err) {
    return {
      provider_path: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

async function gitlabSidecar(config, parsed, prNumber) {
  const token = gitlabToken();
  if (!token) {
    return { provider_path: { error: 'GITLAB_TOKEN not set' } };
  }

  try {
    const url = `${gitlabApiBase(config, parsed)}${projectApiPath(config, 'merge_requests', prNumber)}`;
    const measured = await measureGet(url, gitlabAuthHeaders(token));
    return { provider_path: { ...measured, label: 'gitlab_merge_request' } };
  } catch (err) {
    return {
      provider_path: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

/**
 * @param {{ config: object, parsed: object, providerId: string, prNumber: number }} ctx
 * @returns {Promise<Record<string, { bytes?: number, label?: string, truncated?: boolean, error?: string }>>}
 */
export async function fetchSidecarPrViewBaselines({ config, parsed, providerId, prNumber }) {
  switch (providerId) {
    case 'github-api':
      return githubSidecar(config, parsed, prNumber);
    case 'gitea-api':
      return giteaSidecar(config, parsed, prNumber);
    case 'gitlab-api':
      return gitlabSidecar(config, parsed, prNumber);
    default:
      return {
        provider_path: {
          error: `Sidecar pr_view compare supports github-api, gitea-api, gitlab-api (got ${providerId})`,
        },
      };
  }
}
