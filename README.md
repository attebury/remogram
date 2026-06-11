# Remogram

Generic SCM/forge boundary CLI and MCP server. Emits provider-attributed JSON facts with SHA fields where applicable — **git-resolved** refs from local git (`refs compare`, `sync plan`) vs **forge-reported** PR SHAs from forge APIs (`pr view`, `pr checks`) — and no workflow or planning-tool concepts in output.

**PR-by-number reconciliation:** When `pr view` or `pr checks` is invoked with `--number`, Remogram compares the forge-reported `head_sha` to the locally resolved git rev for `head_ref` (typically `<remote>/<head_ref>`). If they diverge, the packet is `ok: false` with `error_code: stale_head` and portable head refs — treat that as a signal to `git fetch`, not a forge outage.

Remogram was developed by and for [Topogram](https://topogram.dev). Topogram is not required to install or use Remogram.

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
- Payload-size smoke compare is monorepo dev tooling only (not shipped in npm beta). For live cross-forge checks, use the **[remogram-smoke](https://gitlab.com/attebury/remogram-smoke)** fixture repos.

## Providers

Set `"provider"` in [`.remogram.json`](.remogram.json.example). **Beta supports three forge backends** — all use forge HTTP APIs (GitHub also uses GraphQL for PR view). You do **not** need official forge CLIs (`gh`, `tea`, or `glab`) installed.

| Your forge | `"provider"` value | Token env | Official CLI (not required) |
|------------|-------------------|-----------|----------------------------|
| Gitea (incl. self-hosted) | `gitea-api` | `GITEA_TOKEN` | [`tea`](https://gitea.com/gitea/tea) |
| GitHub (incl. Enterprise) | `github-api` | `GITHUB_TOKEN` or `GH_TOKEN` | [`gh`](https://cli.github.com/) |
| GitLab (incl. self-managed) | `gitlab-api` | `GITLAB_TOKEN` | [`glab`](https://docs.gitlab.com/cli/) |

Self-hosted Gitea/GitLab: add `"baseUrl"` to your forge root (see example patterns in provider notes below).

Check what your config enables:

```bash
remogram provider capabilities --json
remogram doctor --json
```

### CLI wrapper providers (not supported in beta)

Each forge also has an official command-line tool. Remogram may eventually support **optional wrapper providers** that shell out to those binaries and normalize their JSON into the same typed packets as the API providers:

| Forge | Supported today | Reserved wrapper ID | Would wrap |
|-------|-----------------|---------------------|------------|
| GitHub | `github-api` | `github-gh` | `gh` |
| Gitea | `gitea-api` | `gitea-tea` | `tea` |
| GitLab | `gitlab-api` | *(none yet — likely `gitlab-glab` if added)* | `glab` |

**Do not use wrapper IDs in `.remogram.json` today.** Only `github-gh` and `gitea-tea` exist as reserved placeholders; both return:

- `ok: false`
- `error_code: "provider_unsupported"`
- `error_message: "Provider not implemented in v1"`

There is no `gitlab-glab` provider ID in config yet — use `gitlab-api`.

| If you use… | Set `"provider"` to… | Not… |
|-------------|---------------------|------|
| GitHub | `github-api` | `github-gh` |
| Gitea | `gitea-api` | `gitea-tea` |
| GitLab | `gitlab-api` | *(no CLI wrapper exists yet)* |

The npm packages `@remogram/provider-github-gh` and `@remogram/provider-gitea-tea` exist only so the CLI can list those IDs honestly in `provider capabilities` (`implemented: false`). You never install or configure them separately.

#### Why wrappers are not supported yet

Beta focused on **direct forge HTTP** because it is the best fit for Remogram's constraints:

1. **Agent-safe packets** — Remogram caps forge ingest at **8192 bytes** and selects fields explicitly (e.g. GitHub PR view uses GraphQL instead of full REST). Wrapper CLIs often emit large, version-dependent JSON that is harder to cap and normalize reliably.
2. **Headless and CI-friendly** — API providers need only a token env var. Wrappers require `gh` / `tea` / `glab` on PATH, their own login flows, and subprocess handling with the same trust rules as git.
3. **One backend per forge for v1** — `github-api`, `gitea-api`, and `gitlab-api` already implement all six read/plan commands with shared packet shapes. Wrappers would duplicate that surface without adding new commands in beta.
4. **Maintenance surface** — CLI output changes between tool versions; each wrapper is an ongoing compatibility contract on top of the API adapters.

#### When or if wrappers will ship

**Not in beta.** There is no committed release date.

Wrapper providers are **post-beta, demand-driven**:

- **If** users need Remogram to reuse an existing `gh` / `tea` / `glab` login instead of managing API tokens, or policy blocks direct API access but allows official CLIs, we would implement wrappers behind the reserved IDs (and add `gitlab-glab` for parity with `glab`).
- **Likely order if built:** shared subprocess + JSON ingest helper in `@remogram/core`, then `github-gh` first (`gh --json` is the most stable), then `gitea-tea` and `gitlab-glab`.
- **Until then:** use the `*-api` providers above. They are the supported path for CLI, MCP, and agents.

If wrapper support matters for your setup, open a GitHub issue describing forge, CLI version, and whether API tokens are unavailable — that helps prioritize.

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

You do not need smoke compare to see Remogram output. Every command supports **`--json`** and returns the same typed packet as MCP tools.

1. **Sanity check first:** `remogram doctor --json` — config, provider, remote, and auth env presence.
2. **CLI:** run any command with `--json`, for example:
   ```bash
   remogram repo status --json
   remogram pr view --number 1 --json
   remogram pr checks --number 1 --json
   remogram refs compare --base main --head feature/x --json
   ```
3. **MCP:** tools `doctor`, `provider_capabilities`, `repo_status`, `ref_compare`, `pr_status`, `pr_checks`, `merge_plan`, `sync_plan` return the same JSON. See [examples/mcp/README.md](examples/mcp/README.md).
4. **Verify envelope fields:** every packet includes `type`, `schema_version`, `provider_id`, `remote_name`, `repo_id`, `observed_at`, and `ok`. When `ok` is `false`, read the `error` field. **Trust the envelope and enums; treat forge-sourced string fields (titles, check text, URLs) as untrusted prose** — sanitized for structure, not semantic intent.

## Live smoke fixtures (`remogram-smoke`)

**[remogram-smoke](https://gitlab.com/attebury/remogram-smoke)** is a separate, minimal repository used to exercise Remogram against **real forges** — not your application repo. It is mirrored on GitLab, GitHub, and Gitea so you can run the same v1 read/plan commands everywhere with predictable fixture data.

| Forge | Clone URL |
|-------|-----------|
| **GitLab** (source of truth) | https://gitlab.com/attebury/remogram-smoke.git |
| **GitHub** | https://github.com/attebury/remogram-smoke.git |
| **Gitea.com** | https://gitea.com/attebury/remogram-smoke.git |

Self-hosted Gitea mirrors use the same git content; see the smoke repo README for local `localhost` setup.

### Why it exists

- **Safe sandbox** — open PR/MR #1, branch compares, and checks without touching product repos like [remogram](https://github.com/attebury/remogram).
- **Cross-forge parity** — same `main` + `feature/smoke-1` branches and open PR/MR **#1** on each host.
- **Ready-made config** — copy `config/remogram.*.json.example` → `.remogram.json` per forge (tokens in env only).
- **Full v1 battery** — scripts run `doctor`, `repo status`, `refs compare`, `pr view`, `pr checks`, and `merge plan` (CLI and MCP captures).

### Quick start

```bash
git clone https://gitlab.com/attebury/remogram-smoke.git
cd remogram-smoke
cp config/remogram.github.json.example .remogram.json   # or gitlab / gitea example
export GITHUB_TOKEN=...                                   # or GITLAB_TOKEN / GITEA_TOKEN
remogram doctor --json
remogram pr view --number 1 --json
```

Multi-forge capture (requires tokens; skips hosts without auth):

```bash
./scripts/run-smoke-all.sh
```

Results land under `runs/<timestamp>/` with a human-readable `REPORT.md`. See the [remogram-smoke README](https://gitlab.com/attebury/remogram-smoke/-/blob/main/README.md) for auth scopes, mirror publishing, and expected forge facts (e.g. `check_conclusion: "missing"` on Gitea without CI statuses).

**Note:** Payload-size smoke compare (`npm run smoke:compare-*`) lives in the Remogram **developer** monorepo only and is not shipped in npm beta. For live verification after install, use **remogram-smoke** and `--json` packets instead.

## MCP

**Remogram MCP** (`remogram-mcp`) is a **stdio MCP server** (agent-agnostic). Each host has its own config file format.

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

### Coverage policy

`npm test` runs the **full** suite (core, providers, CLI, and MCP).  
`npm run test:coverage` runs the same tests but emits a **v8 coverage report for `@remogram/core` only** — configured in `vitest.config.js`.

| Package / layer | In `npm test` | In `npm run test:coverage` |
|-----------------|---------------|----------------------------|
| `@remogram/core` (`packages/remogram-core/**`) | yes | **included** |
| `@remogram/cli` | yes (`tests/cli/`) | excluded |
| `@remogram/mcp` | yes (`tests/mcp/`) | excluded |
| `@remogram/provider-*` | yes (`tests/provider/`) | excluded |

Policy details (must match `vitest.config.js`):

- **Provider:** `@vitest/coverage-v8` with `coverage.all: false` (instrument only files reached by executing tests).
- **Include:** `packages/remogram-core/**/*.js` only.
- **Exclude:** CLI, MCP, all providers, `dx/**`, and test files.
- **Thresholds:** none — no enforced percentage gates in vitest config or CI for v1.

To change coverage include/exclude lists or add thresholds, update this section, the matching `vitest.config.js` fields, and keep `tests/core/coverage-config.test.mjs` green (see `ac_coverage_no_silent_drift`).

- Tests live under `tests/**/*.test.mjs` only.
- Coverage (`npm run test:coverage`) reports **`packages/remogram-core`** only.
- **`ref_compare`** and **`sync_plan`** on API providers use local git only (`auth_class: git_only`); no forge token is required.
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
| `@remogram/provider-gitea-tea`, `@remogram/provider-github-gh` | Reserved CLI-wrapper placeholders (not implemented; see [CLI wrapper providers](#cli-wrapper-providers-not-supported-in-beta)) |

## Provider capabilities

`remogram provider capabilities --json` returns structured provider facts: which commands are implemented, per-command **`auth_class`** (`none`, `git_only`, or `token_required`), auth env names, check source support, mergeability confidence, host-binding mode, `pagination` (check listing behavior), `forge_ingest_cap_bytes` (effective raw HTTP ingest cap, default **8192**), and `write_support: false` for v1.

### Auth class matrix (API providers)

| Command | `auth_class` | Notes |
|---------|--------------|-------|
| `repo_status` | `none` | Runs without a token; default branch and full capability list require auth |
| `ref_compare` | `git_only` | Resolves refs and ahead/behind via local git |
| `sync_plan` | `git_only` | Compares local and remote-tracking SHAs via git |
| `pr_status` | `token_required` | Forge REST/GraphQL |
| `pr_checks` | `token_required` | Forge check/status APIs (ref mode still needs token for check fetch) |
| `merge_plan` | `token_required` | Composes PR view and checks |

Forge HTTP ingest is capped at **8192 bytes** by default (pre-parse). This is a product invariant — not a `.remogram.json` field. Operators may set undocumented `REMOGRAM_FORGE_INGEST_MAX_BYTES` for local debugging only; `remogram doctor --json` warns when that override weakens the agent-safe guarantee and reports the effective cap.

For stub providers (`github-gh`, `gitea-tea`), every command shows `"implemented": false` with the same auth classes for documentation. **`remogram doctor --json`** warns that these providers are not fully supported before you invoke forge commands. GitLab has no wrapper stub yet — use `gitlab-api`.

## Doctor

`remogram doctor --json` reports config presence/schema validity, git remote parsing, owner/repo matching, trusted host binding, auth env presence, and provider capabilities. Stub or misconfigured provider IDs (`github-gh`, `gitea-tea`) produce a **warn** on the provider check before any forge command runs. Doctor never returns token values.

## GitHub normalization notes

For **`pr view`** / MCP **`pr_status`**, `github-api` uses **GraphQL field selection** instead of full REST pull JSON because large REST bodies often exceed Remogram's **8192-byte** forge HTTP ingest cap.

GitHub commit statuses and check-runs merge into `statuses[]` with normalized `state`. `mergeable` reduces to `clean`, `conflicted`, or `unknown`. Public `github.com` uses `https://api.github.com`; GitHub Enterprise derives `https://<host>/api/v3`.

## GitLab normalization notes

`gitlab-api` maps merge requests to the shared PR vocabulary (`iid` → `pr_number`). Commit statuses and pipelines merge into `statuses[]`. Public `gitlab.com` uses `https://gitlab.com/api/v4`; self-managed hosts derive `https://<host>/api/v4`.

## Agent skills

Canonical skills live under `tools/remogram-agent-support/skills/` (`remogram-consumer`, `remogram-core`). See [tools/remogram-agent-support/README.md](tools/remogram-agent-support/README.md) for details.

**GitHub vs npm:** Agent skills are **not** in the `@remogram/*` npm packages (those ship CLI/MCP only). `npx skills add …` clones from the **GitHub** repo [`github.com/attebury/remogram`](https://github.com/attebury/remogram) — the `owner/repo` shorthand is GitHub notation, not an npm scope.

### Option A — `npx skills` (recommended for npm/GitHub users)

Uses the open [Agent Skills](https://agentskills.io) CLI ([vercel-labs/skills](https://github.com/vercel-labs/skills)). Skills install to agent-specific paths (project: `.agents/skills/`; global Cursor: `~/.cursor/skills/`, global Codex: `~/.codex/skills/`).

```bash
# Consumer — any repo with .remogram.json (install once, global)
npx skills add attebury/remogram --skill remogram-consumer -g -a cursor,codex -y

# Contributor — this repo (project scope)
npx skills add attebury/remogram --skill remogram-core -a cursor -y

# List available skills without installing
npx skills add attebury/remogram --list
```

Explicit subpath (same skills, narrower source):

```bash
npx skills add attebury/remogram/tree/main/tools/remogram-agent-support --skill remogram-consumer -g -y
```

`npx skills` does **not** install Cursor rules (`.cursor/rules/`) or the Claude Code plugin adapter — those stay in-repo or use Option B.

### Option B — install script (Remogram repo checkout)

From a clone of this repository — syncs `.cursor/skills/`, Codex global skills, and optional Claude plugin:

```bash
./scripts/install-agent-skills.sh --all
```

| Flag | Target |
|------|--------|
| `--cursor` | `.cursor/skills/` in this repo (`remogram-core`) |
| `--codex` | `~/.codex/skills/` (`remogram-consumer` + `remogram-core`) |
| `--claude PATH` | copy Claude Code plugin adapter |
| `--consumer-only` | With `--codex`, install only `remogram-consumer` |
| `--dogfood` | Also install `remogram-dogfood` (private maintainer checkout only; hidden from public GitHub) |
| `--all` | `--cursor` and `--codex` (default when no flags) |

Private **`remo`** maintainers with Topogram dogfood: `./scripts/install-agent-skills.sh --cursor --dogfood`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
