# remogram

Generic SCM/forge boundary CLI and MCP server. Emits provider-attributed, SHA-bound JSON facts only — no SDLC or workflow concepts in output.

remogram was developed by and for [Topogram](https://topogram.dev). Topogram is not required to install or use remogram.

## Install (beta)

```bash
npm install -g @remogram/cli@beta @remogram/mcp@beta
```

From a git checkout (development):

```bash
git clone https://github.com/attebury/remogram.git
cd remogram
npm ci
./scripts/npm-link.sh
```

Default branch: **`main`**.

### Beta limitations

- **Read/plan v1 only** — no PR create, merge execute, or push.
- Wrapper providers (`gitea-tea`, `github-gh`) are stubs that return `provider_unsupported`.
- Payload-size smoke compare is monorepo dev tooling only (not shipped in npm beta).

## Consumer config

Copy [`.remogram.json.example`](.remogram.json.example) to your repo root.

Auth env vars by provider:

| Provider | Token env |
|----------|-----------|
| `gitea-api` | `GITEA_TOKEN` |
| `github-api` | `GITHUB_TOKEN` or `GH_TOKEN` |
| `gitlab-api` | `GITLAB_TOKEN` |

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

## Inspect and verify packets

You do not need smoke compare to see remogram output. Every command supports **`--json`** and returns the same typed packet as MCP tools.

1. **Sanity check first:** `remogram doctor --json` — config, provider, remote, and auth env presence.
2. **CLI:** run any command with `--json`, for example:
   ```bash
   remogram repo status --json
   remogram pr view --number 1 --json
   remogram pr checks --number 1 --json
   remogram refs compare --base main --head feature/x --json
   ```
3. **MCP:** tools `doctor`, `provider_capabilities`, `repo_status`, `ref_compare`, `pr_status`, `pr_checks`, `merge_plan`, `sync_plan` return the same JSON. See [examples/mcp/README.md](examples/mcp/README.md).
4. **Verify envelope fields:** every packet includes `type`, `schema_version`, `provider_id`, `remote_name`, `repo_id`, `observed_at`, and `ok`. When `ok` is `false`, read the `error` field.

## MCP

remogram-mcp is a **stdio MCP server** (agent-agnostic). Each host has its own config file format.

```bash
./scripts/npm-link.sh                 # remogram-mcp on PATH
./scripts/install-project-mcp.sh      # Cursor only: .cursor/mcp.json.example → .cursor/mcp.json
```

Labeled examples for Cursor, Claude Desktop, OpenAI Codex, and Claude Code: [examples/mcp/README.md](examples/mcp/README.md).

Set the provider-specific token in your environment. In consumer repos, set `REMOGRAM_CWD` to the repo root (see examples).

## Testing

```bash
npm test              # full suite
npm run test:coverage # remogram-core coverage report
npm run security:secrets -- --full-history
```

Optional local pre-push gate: `./scripts/install-pre-push-hook.sh`.

| Layer | Location | What runs |
|-------|----------|-----------|
| Core unit | `tests/core/` | Envelope, caps, HTTP, packet contracts |
| Provider | `tests/provider/` | API adapters with mocked `fetch` + fixtures |
| CLI integration | `tests/cli/` | Read-only commands via `runCli` with mock provider |
| MCP | `tests/mcp/` | Tool listing, offline `callTool`, packet shaping |

- Tests live under `tests/**/*.test.mjs` only.
- Coverage (`npm run test:coverage`) reports **`packages/remogram-core`** only.
- **`ref_compare`** on API providers requires a forge auth env var even though comparison uses local git; **`sync_plan`** does not.
- **CI:** GitHub Actions on push/PR to `main` (`.github/workflows/`).

## Packages

| Package | Role |
|---------|------|
| `@remogram/core` | Envelope, config, caps, HTTP utils |
| `@remogram/cli` | CLI surface |
| `@remogram/mcp` | MCP stdio adapter (delegates to CLI) |
| `@remogram/provider-gitea-api` | Gitea REST adapter |
| `@remogram/provider-github-api` | GitHub REST/GraphQL adapter |
| `@remogram/provider-gitlab-api` | GitLab REST adapter |
| `@remogram/provider-gitea-tea`, `@remogram/provider-github-gh` | Wrapper stubs → `provider_unsupported` |

## Provider capabilities

`remogram provider capabilities --json` returns structured provider facts: implemented commands, auth env names, check source support, mergeability confidence, host-binding mode, and `write_support: false` for v1.

## Doctor

`remogram doctor --json` reports config presence/schema validity, git remote parsing, owner/repo matching, trusted host binding, auth env presence, and provider capabilities. It never returns token values.

## GitHub normalization notes

For **`pr view`** / MCP **`pr_status`**, `github-api` uses **GraphQL field selection** instead of full REST pull JSON because large REST bodies often exceed remogram's **8192-byte** forge HTTP ingest cap.

GitHub commit statuses and check-runs merge into `statuses[]` with normalized `state`. `mergeable` reduces to `clean`, `conflicted`, or `unknown`. Public `github.com` uses `https://api.github.com`; GitHub Enterprise derives `https://<host>/api/v3`.

## GitLab normalization notes

`gitlab-api` maps merge requests to the shared PR vocabulary (`iid` → `pr_number`). Commit statuses and pipelines merge into `statuses[]`. Public `gitlab.com` uses `https://gitlab.com/api/v4`; self-managed hosts derive `https://<host>/api/v4`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Agent skills: `./scripts/install-agent-skills.sh --all`.
