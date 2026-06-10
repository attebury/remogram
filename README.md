# remogram

Generic SCM/forge boundary CLI and MCP server. Emits provider-attributed, SHA-bound JSON facts only — no Topogram or SDLC concepts in output.

Sibling to [Topogram](https://github.com/attebury/topogram): Topogram models remogram in `topo/` during development; remogram has **no Topogram runtime dependency**.

## Branch model

| Branch | Role |
|--------|------|
| **`remo`** | Sole integration authority — merged product line, forge default, Merge Lane target |
| **`goal/*`, `plan/*`** | Topogram lane archaeology and workflow branches (not integration authority) |

Clone and open PRs against **`remo`**. Topogram commands in this repo use `--base origin/remo` unless reviewing a historical ref. See [AGENTS.md](AGENTS.md) and [agent skills](tools/remogram-agent-support/README.md).

## Bootstrap

```bash
cd ~/Documents/remogram
./scripts/install-topogram-local.sh
npm run topo:init    # first time only
npm run topo:check
npm link --workspace packages/remogram-cli
npm link --workspace packages/remogram-mcp
```

Requires sibling checkout at `~/Documents/topogram` (or `TOPOGRAM_ENGINE`).

## Consumer config

Copy `.remogram.json.example` to your repo root. Auth uses `GITEA_TOKEN` for `gitea-api`; `github-api` resolves `GITHUB_TOKEN` first, then `GH_TOKEN`; `gitlab-api` uses `GITLAB_TOKEN`.

## Commands (v1 — read/plan only)

```bash
remogram provider capabilities --json
remogram doctor --json
remogram repo status --json
remogram refs compare --base main --head feature/x --json
remogram pr view --number 1 --json
remogram pr checks --number 1 --json
remogram merge plan --number 1 --json
remogram sync plan --remote origin --json
```

## MCP

```bash
./scripts/npm-link.sh              # remogram-mcp on PATH
./scripts/install-project-mcp.sh     # copies .cursor/mcp.json.example → .cursor/mcp.json
```

Reload MCP in Cursor (Settings → MCP). Tools: `doctor`, `provider_capabilities`, `repo_status`, `ref_compare`, `pr_status`, `pr_checks`, `merge_plan`, `sync_plan`.

Each tool returns the same JSON as `remogram ... --json`. Set the provider-specific token in your environment.

## SDLC (development)

```bash
topogram work start task_remogram_core . --actor <you> --write --json
topogram sdlc prep commit . --json
```

See [AGENTS.md](AGENTS.md).

## Testing

```bash
npm test              # full suite
npm run test:coverage # remogram-core coverage report
npm run security:secrets -- --base origin/remo
```

Use `npm run security:secrets -- --full-history` when no reliable base ref exists.
Optional local pre-push gate: `./scripts/install-pre-push-hook.sh` (origin pushes only).

| Layer | Location | What runs | Git required |
|-------|----------|-----------|--------------|
| Core unit | `tests/core/` | Envelope, caps, `assertForgeReady`, HTTP, packet contracts | Temp repos in `resolve.test.mjs` only |
| Provider | `tests/provider/` | Gitea and GitHub API adapters with mocked `fetch` + JSON fixtures | Some tests resolve refs via local git |
| CLI integration | `tests/cli/` | All read-only commands via `runCli` with temp `.remogram.json` and injected mock provider; default `PROVIDERS` wiring in `default-providers.test.mjs` | Temp git repo per test |
| MCP | `tests/mcp/` | `packetToMcpContent` unit tests + stdio server smoke | Smoke uses repo cwd |

- Tests live under `tests/**/*.test.mjs` only.
- `dx/` agent progress logs are **excluded** from test and coverage scope.
- `runCli(argv, { cwd, providers })` accepts `options.providers` **for tests only** — production CLI and MCP spawn use the built-in `PROVIDERS` map; do not inject providers in app code.
- Coverage (`npm run test:coverage`) reports **`packages/remogram-core`** only — not MCP or provider packages.
- **CI:** GitHub Actions (`.github/workflows/test.yml`, `.github/workflows/secret-scan.yml`) runs on push/PR when hosted on GitHub. For local **Gitea**, mirror workflows live under `.gitea/workflows/` (Node 20, stub Topogram sibling, `npm ci`, `npm test`, `npm run test:coverage`, plus Gitleaks via `npm run security:secrets`). Gitea Actions may require enabling workflows in server settings.
- **Lane checks:** `remogram pr checks` reads forge commit statuses. On local Gitea without Actions/status posting, `check_conclusion: "missing"` is expected. In that mode, lanes still use remogram for PR facts and mergeability, then require local proof (`topogram check . --json`, `npm test`) before merge. Missing statuses are not a substitute for failed statuses; if the forge reports failure or pending, treat that as a blocker.

## Packages

| Package | Role |
|---------|------|
| `remogram-core` | Envelope, config, caps, HTTP utils |
| `remogram-cli` | CLI surface |
| `remogram-mcp` | MCP stdio adapter (delegates to CLI) |
| `provider-gitea-api` | Gitea REST adapter |
| `provider-github-api` | GitHub REST v3 adapter |
| `provider-gitlab-api` | GitLab REST v4 adapter |
| `provider-gitea-tea`, `provider-github-gh` | Proposed wrapper providers → `provider_unsupported` |

## Provider Capabilities

`remogram provider capabilities --json` returns structured provider facts so agents do not infer behavior from provider names. It reports implemented read/plan commands, auth environment variable names, check source support, mergeability confidence, host-binding mode, pagination status, and `write_support: false` for v1.

## Doctor

`remogram doctor --json` returns a provider-attributed readiness packet for config presence/schema validity, git remote parsing, owner/repo matching, trusted host binding, auth environment presence, provider capabilities, and check-source support. It reports auth env names and whether one is present, but never token values. Live API reachability is not checked by default.

## GitHub Normalization Notes

`github-api` keeps the shared v1 envelope unchanged. GitHub commit statuses and check-runs are merged into the existing `statuses[]` body with `context`, normalized `state`, and `description`; check-runs that are queued or in progress become `pending`, successful/neutral/skipped runs become `success`, failed/cancelled/timed-out/action-required runs become `failure`, and unmapped values become `unknown`.

GitHub `mergeable` and `mergeable_state` are reduced to `clean`, `conflicted`, or `unknown`. Values that do not prove a clean or conflicted merge stay `unknown` instead of widening packet shape. Public `github.com` remotes always use `https://api.github.com`; GitHub Enterprise remotes derive `https://<verified-host>/api/v3`.

## GitLab Normalization Notes

`gitlab-api` maps GitLab Merge Requests to the existing PR packet vocabulary. Merge request `iid` becomes `pr_number`; `opened` becomes `open`; target/source branches map to base/head refs. GitLab `detailed_merge_status`, `merge_status`, and `has_conflicts` reduce to `clean`, `conflicted`, or `unknown`.

GitLab commit statuses and pipelines are merged into the shared `statuses[]` body. `success` and `skipped` become `success`; `failed` and `canceled` become `failure`; queued/running/manual states become `pending`; unmapped states become `unknown`. Public `gitlab.com` remotes always use `https://gitlab.com/api/v4`; self-managed GitLab remotes derive `https://<verified-host>/api/v4`. The first implementation supports the existing `owner` + `repo` config shape (`namespace/project`) and does not widen config for nested subgroups.
