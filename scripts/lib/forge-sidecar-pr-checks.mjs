/**
 * Smoke-only forge HTTP fetches for pr_checks baseline byte measurement.
 */
import {
  apiBase as githubApiBase,
  authHeaders as githubAuthHeaders,
  githubToken,
  graphqlEndpoint,
  repoApiPath as githubRepoApiPath,
} from '@remogram/provider-github-api';
import {
  authHeaders as giteaAuthHeaders,
  giteaToken,
  repoApiPath as giteaRepoApiPath,
  apiBase as giteaApiBase,
} from '@remogram/provider-gitea-api';
import {
  authHeaders as gitlabAuthHeaders,
  gitlabToken,
  projectApiPath,
  apiBase as gitlabApiBase,
} from '@remogram/provider-gitlab-api';
import {
  fetchJsonMeasured,
  measureGet,
  loadSmokeForgeContext,
} from './forge-sidecar-http.mjs';

export { loadSmokeForgeContext };

const PR_HEAD_SHA_QUERY = `
query RemogramPrHeadSha($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      headRefOid
    }
  }
}
`;

function baselineEntry(measured, label) {
  return { ...measured, label };
}

function baselineError(err) {
  return { error: err instanceof Error ? err.message : String(err) };
}

async function githubHeadSha(config, parsed, prNumber) {
  const auth = githubToken();
  if (!auth.token) throw new Error('GITHUB_TOKEN or GH_TOKEN not set');
  const headers = githubAuthHeaders(auth.token);
  const url = graphqlEndpoint(config, parsed);
  const { bytes, truncated, data } = await fetchJsonMeasured(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: PR_HEAD_SHA_QUERY,
      variables: { owner: config.owner, repo: config.repo, number: prNumber },
    }),
  });
  const sha = data?.data?.repository?.pullRequest?.headRefOid;
  if (!sha) throw new Error('Could not resolve head SHA from GraphQL');
  return { sha, head_resolve_graphql: { bytes, truncated, label: 'github_graphql_head_sha' } };
}

async function githubPrChecksSidecar(config, parsed, prNumber) {
  const auth = githubToken();
  if (!auth.token) {
    return {
      head_resolve_graphql: { error: 'GITHUB_TOKEN or GH_TOKEN not set' },
      commit_statuses: { error: 'GITHUB_TOKEN or GH_TOKEN not set' },
      check_runs: { error: 'GITHUB_TOKEN or GH_TOKEN not set' },
    };
  }

  const baselines = {};
  let sha;

  try {
    const head = await githubHeadSha(config, parsed, prNumber);
    sha = head.sha;
    baselines.head_resolve_graphql = head.head_resolve_graphql;
  } catch (err) {
    baselines.head_resolve_graphql = baselineError(err);
    return baselines;
  }

  const headers = githubAuthHeaders(auth.token);
  const apiRoot = githubApiBase(config, parsed);

  try {
    const path = githubRepoApiPath(config, 'commits', sha, 'statuses');
    baselines.commit_statuses = baselineEntry(
      await measureGet(`${apiRoot}${path}`, headers),
      'github_commit_statuses',
    );
  } catch (err) {
    baselines.commit_statuses = baselineError(err);
  }

  try {
    const path = githubRepoApiPath(config, 'commits', sha, 'check-runs');
    baselines.check_runs = baselineEntry(
      await measureGet(`${apiRoot}${path}`, headers),
      'github_check_runs',
    );
  } catch (err) {
    baselines.check_runs = baselineError(err);
  }

  return baselines;
}

async function giteaPrChecksSidecar(config, parsed, prNumber) {
  const token = giteaToken();
  if (!token) {
    return {
      rest_pull: { error: 'GITEA_TOKEN not set' },
      commit_statuses: { error: 'GITEA_TOKEN not set' },
    };
  }

  const headers = giteaAuthHeaders(token);
  const base = giteaApiBase(config, parsed);
  const baselines = {};
  let sha;

  try {
    const pullPath = giteaRepoApiPath(config, 'pulls', prNumber);
    const pull = await fetchJsonMeasured(`${base}${pullPath}`, { headers });
    baselines.rest_pull = baselineEntry(
      { bytes: pull.bytes, truncated: pull.truncated },
      'gitea_rest_pull',
    );
    sha = pull.data?.head?.sha;
    if (!sha) throw new Error('Could not resolve head SHA from pull');
  } catch (err) {
    baselines.rest_pull = baselineError(err);
    return baselines;
  }

  try {
    const path = giteaRepoApiPath(config, 'commits', sha, 'statuses');
    baselines.commit_statuses = baselineEntry(
      await measureGet(`${base}${path}`, headers),
      'gitea_commit_statuses',
    );
  } catch (err) {
    baselines.commit_statuses = baselineError(err);
  }

  return baselines;
}

async function gitlabPrChecksSidecar(config, parsed, prNumber) {
  const token = gitlabToken();
  if (!token) {
    return {
      merge_request: { error: 'GITLAB_TOKEN not set' },
      commit_statuses: { error: 'GITLAB_TOKEN not set' },
      pipelines: { error: 'GITLAB_TOKEN not set' },
    };
  }

  const headers = gitlabAuthHeaders(token);
  const base = gitlabApiBase(config, parsed);
  const baselines = {};
  let sha;

  try {
    const mrPath = projectApiPath(config, 'merge_requests', prNumber);
    const mr = await fetchJsonMeasured(`${base}${mrPath}`, { headers });
    baselines.merge_request = baselineEntry(
      { bytes: mr.bytes, truncated: mr.truncated },
      'gitlab_merge_request',
    );
    sha = mr.data?.sha ?? mr.data?.diff_refs?.head_sha;
    if (!sha) throw new Error('Could not resolve head SHA from merge request');
  } catch (err) {
    baselines.merge_request = baselineError(err);
    return baselines;
  }

  try {
    const path = projectApiPath(config, 'repository', 'commits', sha, 'statuses');
    baselines.commit_statuses = baselineEntry(
      await measureGet(`${base}${path}`, headers),
      'gitlab_commit_statuses',
    );
  } catch (err) {
    baselines.commit_statuses = baselineError(err);
  }

  try {
    const path = `${projectApiPath(config, 'pipelines')}?sha=${encodeURIComponent(sha)}`;
    baselines.pipelines = baselineEntry(await measureGet(`${base}${path}`, headers), 'gitlab_pipelines');
  } catch (err) {
    baselines.pipelines = baselineError(err);
  }

  return baselines;
}

export async function fetchSidecarPrChecksBaselines({ config, parsed, providerId, prNumber }) {
  switch (providerId) {
    case 'github-api':
      return githubPrChecksSidecar(config, parsed, prNumber);
    case 'gitea-api':
      return giteaPrChecksSidecar(config, parsed, prNumber);
    case 'gitlab-api':
      return gitlabPrChecksSidecar(config, parsed, prNumber);
    default:
      return {
        provider_path: {
          error: `Sidecar pr_checks compare supports github-api, gitea-api, gitlab-api (got ${providerId})`,
        },
      };
  }
}
