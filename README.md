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
- Payload-size smoke compare is monorepo dev tooling only (not shipped in npm beta).

## Providers

Set `"provider"` in [`.remogram.json`](.remogram.json.example). **Beta supports three forge backends** — all use forge HTTP APIs (GitHub also uses GraphQL for PR view). You do **not** need the `gh` or `tea` CLIs installed.

| Your forge | `"provider"` value | Token env |
|------------|-------------------|-----------|
| Gitea (incl. self-hosted) | `gitea-api` | `GITEA_TOKEN` |
| GitHub (incl. Enterprise) | `github-api` | `GITHUB_TOKEN` or `GH_TOKEN` |
| GitLab (incl. self-managed) | `gitlab-api` | `GITLAB_TOKEN` |

Self-hosted Gitea/GitLab: add `"baseUrl"` to your forge root (see example patterns in provider notes below).

Check what your config enables:

```bash
remogram provider capabilities --json
remogram doctor --json
```

### Not supported yet: `github-gh` and `gitea-tea`

`github-gh` and `gitea-tea` are **reserved provider IDs** for a possible future mode: delegate to the official [`gh`](https://cli.github.com/) and [`tea`](https://gitea.com/gitea/tea) command-line tools instead of remogram's REST/GraphQL adapters.

**They are not implemented in beta.** Do not put them in `.remogram.json`. If you do, commands fail with a typed packet:

- `ok: false`
- `error_code: "provider_unsupported"`
- `error_message: "Provider not implemented in v1"`

| If you use… | Set `"provider"` to… | Not… |
|-------------|---------------------|------|
| GitHub | `github-api` | `github-gh` |
| Gitea | `gitea-api` | `gitea-tea` |

The npm packages `@remogram/provider-github-gh` and `@remogram/provider-gitea-tea` exist only so the CLI can list these IDs honestly in `provider capabilities` (`implemented: false`). You never install or configure them separately.

## Consumer config

Copy [`.remogram.json.example`](.remogram.json.example) to your repo root and set `provider`, `owner`, `repo`, and `remote` to match your project.

Example for GitHub:

```json
{
  "version": "1",
  "provider": "github-api",
  "remote": "origin",
  "owner": "your-org",
  "repo": "your-repo"
}
```

Example for self-hosted Gitea:

```json
{
  "version": "1",
  "provider": "gitea-api",
  "remote": "origin",
  "owner": "your-org",
  "repo": "your-repo",
  "baseUrl": "https://forge.example.com"
}
```

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
| `@remogram/provider-gitea-api` | Gitea REST — **use with `"provider": "gitea-api"`** |
| `@remogram/provider-github-api` | GitHub REST/GraphQL — **use with `"provider": "github-api"`** |
| `@remogram/provider-gitlab-api` | GitLab REST — **use with `"provider": "gitlab-api"`** |
| `@remogram/provider-gitea-tea`, `@remogram/provider-github-gh` | Reserved placeholders (not implemented; see [Providers](#not-supported-yet-github-gh-and-gitea-tea)) |

## Provider capabilities

`remogram provider capabilities --json` returns structured provider facts: which commands are implemented, auth env names, check source support, mergeability confidence, host-binding mode, and `write_support: false` for v1.

For stub providers (`github-gh`, `gitea-tea`), every command shows `"implemented": false`.

## Doctor

`remogram doctor --json` reports config presence/schema validity, git remote parsing, owner/repo matching, trusted host binding, auth env presence, and provider capabilities. It never returns token values.

## GitHub normalization notes

For **`pr view`** / MCP **`pr_status`**, `github-api` uses **GraphQL field selection** instead of full REST pull JSON because large REST bodies often exceed remogram's **8192-byte** forge HTTP ingest cap.

GitHub commit statuses and check-runs merge into `statuses[]` with normalized `state`. `mergeable` reduces to `clean`, `conflicted`, or `unknown`. Public `github.com` uses `https://api.github.com`; GitHub Enterprise derives `https://<host>/api/v3`.

## GitLab normalization notes

`gitlab-api` maps merge requests to the shared PR vocabulary (`iid` → `pr_number`). Commit statuses and pipelines merge into `statuses[]`. Public `gitlab.com` uses `https://gitlab.com/api/v4`; self-managed hosts derive `https://<host>/api/v4`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Agent skills: `./scripts/install-agent-skills.sh --all`.
