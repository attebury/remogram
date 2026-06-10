/**
 * Smoke-only forge HTTP fetches for pr_view baseline byte measurement.
 */
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
import { loadSmokeForgeContext, measureGet, measurePostJson } from './forge-sidecar-http.mjs';

export { loadSmokeForgeContext };

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
