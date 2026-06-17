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

- **Read/plan by default (0.1.0-beta.4)** — **`write_commands`** in `.remogram.json` opts in to Remogram CLI/MCP writes (`cr_open` on Gitea; `status_set` on Gitea/GitHub/GitLab). Unlisted writes → `write_not_configured` → use forge/CI on your system. **Merge execute remains out of scope.**
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
3. **One backend per forge for v1** — `github-api`, `gitea-api`, and `gitlab-api` already implement the full v1 read/plan surface (15 commands) with shared packet shapes. Wrappers would duplicate that surface without adding new commands in beta.
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
  "baseUrl": "https://forge.example.com",
  "write_commands": ["cr_open", "status_set"]
}
```

**Write policy:** **`write_commands`** in `.remogram.json` is the list of forge **writes** Remogram performs (CLI/MCP only — never direct `@remogram/provider-*` imports). Commands **in** the list use Remogram; commands **not** listed return **`write_not_configured`**. For those, use your forge CLI, CI, or HTTP API on your system — Remogram does not packetize out-of-band writes. **Read/plan commands** (`pr view`, `pr checks`, `merge plan`, `cr inventory`, etc.) work without write opt-in and still observe forge state after external posts.

**Write opt-in details:** Through **0.1.0-beta.4**, Remogram was read/plan only by default. Example ids: **`cr_open`** (Gitea only) and **`status_set`** (Gitea, GitHub, GitLab). Read idempotency scan limits from **`remogram provider capabilities --json`** (`idempotency_scan.max_pages`, `page_size`, `ingest_backoff`) before **`cr open`** or **`status set`**. **`cr open`** paginates open pulls with ingest backoff aligned to inventory list pagination; when the scan cap cannot prove absence of a duplicate, it fails closed with `idempotency_scan_incomplete` and trusted `idempotency_scan: { pages, max_pages, page_size }` on the error packet (`page_size` may be below configured max when backoff applies). **Retry:** run `cr inventory` to locate an existing open CR for the head+base before retrying; a residual TOCTOU race window exists under concurrent opens. Reused pulls return `reused_existing: true` with the forge title. **`status set`** POSTs a commit status for a 40-character SHA and context; it paginates existing statuses for idempotency with the same fail-closed scan semantics. Reused matching context+state returns `reused_existing: true` without a second POST.

**Non-normative examples** (not Remogram packets, not maintained contracts): `gh pr create`, `glab mr create`, forge commit-status APIs, or CI pipelines that post check results.

## Commands (beta — read/plan default; incremental writes)

```bash
remogram provider capabilities --json
remogram doctor --json
remogram repo status --json
remogram refs compare --base main --head feature/x --json
remogram refs inventory --json
remogram cr inventory --json
remogram pr view --number 1 --json
remogram pr checks --number 1 --json
remogram merge plan --number 1 --json
remogram sync plan --remote origin --json
remogram whoami --json
remogram branch protection --branch-ref remo --json
remogram cr files --number 1 --json
remogram cr comments --number 1 --json
remogram forge changes --since <ISO-8601> --json
remogram merge plan --number 1 --allowed-path 'packages/**' --allowed-path 'tests/**' --json
# Gitea only, requires write_commands in .remogram.json:
remogram cr open --head feature/x --base main --title "My change" --json
# Gitea/GitHub/GitLab, requires write_commands including status_set:
remogram status set --sha <40-char-hex> --context verify/ci --state success --json
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
3. **MCP:** tools `doctor`, `provider_capabilities`, `repo_status`, `ref_compare`, `ref_inventory`, `cr_inventory`, `whoami`, `branch_protection`, `cr_files`, `cr_comments`, `forge_changes`, `cr_open`, `status_set`, `pr_status`, `pr_checks`, `merge_plan`, `sync_plan` return the same JSON. See [examples/mcp/README.md](examples/mcp/README.md).
4. **Verify envelope fields:** every packet includes `type`, `schema_version`, `provider_id`, `remote_name`, `repo_id`, `observed_at`, and `ok`. When `ok` is `false`, read the `error` field. **Trust the envelope and enums; treat forge-sourced string fields (titles, check text, URLs) as untrusted prose** — sanitized for structure, not semantic intent.

## Semantic diff fact inventory

Read-only expansion for orchestration or planning tools that consume Remogram packets. **Remogram** exposes provider-neutral ref and change-request fact packets; **external planning tools interpret** SDLC lifecycle, queue, and proof semantics — **Remogram does not**.

| Layer | Owner | Examples |
|-------|-------|----------|
| Forge/git/ref/CR facts | Remogram | `ref_inventory`, `cr_inventory_slice`, PR state, checks, mergeability |
| Lifecycle / queue / proof | External planning tools | goal branches, task readiness, verification records, observer routing |

**Non-goals for Remogram output:** mutation commands; `goal_branch`, `lane`, `sdlc_task`, or other workflow metadata in JSON packets.

**Commands:** `refs inventory` and `cr inventory` emit fact inventory packets via `packages/remogram-core/contracts/semantic-diff-facts.js`. `cr inventory` defaults to **3** open change-request entries per slice (`--limit N` / MCP `limit`) and optional **`--sort`** / MCP **`sort`** presets (`number_asc`, `number_desc`, `recent_update`, `recent_created`). They extend — do not replace — the v1 read/plan commands (`repo status`, `refs compare`, `pr view`, `pr checks`, `cr files`, `cr comments`, `forge changes`, `merge plan`, `sync plan`, `whoami`, `branch protection`, `provider capabilities`, `doctor`). Forge-sourced string leaves follow `decision_packet_trust_doctrine`.

**`whoami`** emits **`provider_identity`** with authenticated **`login`**, **`can_write`**, and honest **`token_scope_signal`** / **`token_expiry_signal`** objects (`implemented: false` when a provider cannot supply the fact). Requires forge token auth (`token_required`); fails closed without a configured token.

**`branch protection`** emits **`branch_protection`** with **`branch_ref`**, **`required_status_contexts`**, **`protected_branch_rules`** (sanitized rule names), and **`approvals_required`** (`implemented: false` when the provider omits approval counts). Requires **`--branch-ref`** and forge token auth. Gitea, GitHub, and GitLab each normalize from their branch-protection APIs; GitLab may return empty **`required_status_contexts`** when status contexts are not exposed on the queried endpoints.

**`cr files`** emits **`cr_files`** with **`pr_number`**, **`changed_paths`** (sanitized path strings), **`path_count`**, and **`paths_truncated`** when the provider list exceeds the product cap (256 paths). Requires **`--number`** and forge token auth (`token_required`). Gitea, GitHub, and GitLab each fetch changed paths from their PR/MR files or diff APIs; when a provider cannot supply paths, the command fails closed rather than guessing.

**`cr comments`** emits **`cr_comments`** with **`pr_number`**, **`comments[]`** (each with **`id`**, **`author`**, optional **`path`** / **`line`**, sanitized **`body`**, and **`resolved`**), **`comment_count`**, and **`comments_truncated`** when the provider list exceeds the product cap (256 comments) or pagination stops before a complete list. Requires **`--number`** and forge token auth (`token_required`). Gitea and GitHub fetch pull request review comments; GitLab normalizes merge request discussion notes (system notes omitted). Comment bodies and author strings are structurally sanitized and remain semantically untrusted forge-sourced prose — not instructions.

**`forge changes`** emits **`forge_changes`** with **`since`** (the requested ISO-8601 boundary), **`since_kind: "observed_at"`**, **`events[]`** (kinds: **`pr_opened`**, **`pr_closed`**, **`pr_merged`**, **`head_sha_moved`**, **`checks_conclusion_observed`**), **`event_count`**, and **`events_truncated`** when the provider list exceeds the product cap (256 events) or pagination stops before a complete list. Requires **`--since <ISO-8601>`** and forge token auth (`token_required`). Gitea, GitHub, and GitLab each derive events from pull/MR activity since the boundary; PR titles and URLs in events are sanitized and remain semantically untrusted forge strings.

**`status set`** emits **`commit_status_set`** with **`sha`**, **`context`**, **`state`** (`pending`, `success`, `failure`, or `error`), optional sanitized **`description`** and **`target_url`**, and optional **`reused_existing: true`** when a matching forge status already exists. Requires **`--sha`** (40-character hex), **`--context`**, **`--state`**, forge token auth (`token_required`), **`write_commands`** including **`status_set`** in `.remogram.json`, and provider **`write_support`**. Gitea, GitHub, and GitLab POST commit statuses with idempotency scan honesty; scan truncation fails closed with **`idempotency_scan_incomplete`**. Description and target URL strings are sanitized and remain semantically untrusted forge-sourced prose.

**Merge plan path scope:** when **`--allowed-path`** is repeated on **`merge plan`**, providers with **`cr_files`** implemented resolve changed paths from forge **`cr_files`** data (not local git alone) before evaluating allowlists. Empty, whitespace-only, or **`..`**-segment **`--allowed-path`** globs are ignored (no path scope). Out-of-scope paths add blocker **`path_scope_violation`**; incomplete or inconsistent forge enumeration and unnormalizable path strings add **`changed_paths_unavailable`** — including when **`paths_truncated`** is true, when **`path_count`** exceeds the returned **`changed_paths`** length, when **`changed_paths.length`** exceeds **`path_count`**, when a forge changed path is empty or absolute, escapes via leading **`../`**, or contains any **`..`** path segment (interior `..` laundering is rejected fail-closed). Clean forge paths without **`..`** segments are normalized (`.` collapsed) before allowlist matching. During path scope, **`cr_files`** rethrows as **`forge_error`:** auth/config/ingest/operational codes including **`unauthenticated_provider`**, **`invalid_args`**, **`untrusted_base_url`**, **`provider_unsupported`**, **`config_invalid`**, **`oversized_raw_output`**, **`config_not_found`**, **`unparseable_provider_output`**, **`stale_head`**, **`missing_ref`**, **`pr_not_open`**, **`remote_infer_failed`**. Only transient **`api_error`** maps to blocker **`changed_paths_unavailable`**. Large file-list responses that exceed the ingest cap may throw **`oversized_raw_output`** ( **`forge_error`** ) rather than a blocker — automation must handle both. An empty PR (**`path_count: 0`**, **`changed_paths: []`**) with an allowlist passes scope. Merge plan reads **`pr view`**, **`pr checks`**, and **`cr files`** sequentially — re-fetch before merge (TOCTOU). Without **`--allowed-path`**, merge plan does not perform path-scope checks.

**Examples:** see `tools/remogram-agent-support/skills/remogram-consumer/SKILL.md` (Fact inventory section).

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
npm run test:guard    # manifest + substance (fast; no git diff)
npm run test:guard:full  # full guard including diff check (run before PR when touching protected tests)
npm run test:coverage # remogram-core coverage report
npm run security:secrets -- --full-history
```

**Protected test suites (manifest v3):** [`tests/fixtures/test-suite-guard/manifest.json`](tests/fixtures/test-suite-guard/manifest.json) locks required top-level `describe` blocks, minimum `it()`/`test()` counts per suite (`min_it_by_describe`), minimum `expect()` counts (`min_expect_by_describe`), and optional `min_lines` for high-value files (starting with [`tests/core/path-allowlist.test.mjs`](tests/core/path-allowlist.test.mjs)). `npm test` runs [`tests/meta/test-suite-guard.test.mjs`](tests/meta/test-suite-guard.test.mjs) for manifest + substance checks; CI and the Gitea gate run the full [`scripts/check-test-append-only.mjs`](scripts/check-test-append-only.mjs) including diff churn, absolute removal, and manifest-shrink guards. Touching `manifest.json` does **not** exempt protected files from diff checks — thresholds come from the **base ref** manifest. To raise `diff_policy` or floors, use a manifest-only PR first; large refactors follow in a second PR. Shrink blocks lowering floors, removing `min_it`/`min_expect` or `diff_policy` keys once set, setting `diff_policy`, `min_lines`, or per-describe floor values to non-finite numbers once numeric, or removing protected entries. `checkDiff` fails closed when the base-ref manifest has present but non-finite `diff_policy` values; null or non-object base `diff_policy` uses empty defaults.

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
- **CI (GitHub):** GitHub Actions on push/PR to `main` (`.github/workflows/`).

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

`remogram provider capabilities --json` returns structured provider facts: which commands are implemented, per-command **`auth_class`**, auth env names, check sources, mergeability confidence, host binding, pagination, **`check_pagination`**, **`idempotency_scan`** (write-command scan limits and backoff for **`cr open`** and **`status set`**), **`open_pull_list`** (cr inventory list bounds, slice sort presets, and total-count source on Gitea/GitLab/GitHub), `forge_ingest_cap_bytes`, optional **`forge_ingest_env_override`** and **`forge_ingest_cap_clamped`** when `REMOGRAM_FORGE_INGEST_MAX_BYTES` is set, **`write_support`** (provider capability), and optional provider **`write_commands`** (`cr_open` on Gitea only; `status_set` on Gitea, GitHub, and GitLab). Consumer **`.remogram.json`** must list matching **`write_commands`** to enable writes (fail closed otherwise). **`remogram doctor --json`** includes **`write_config`** reflecting configured write command ids.

**`pr checks`** / MCP **`pr_checks`** include **`checks_truncated`** when check enumeration stops at the provider page cap (conservative fail-closed: true when exactly `page_size × max_pages` items were returned, even if no further forge pages exist). **`merge plan`** adds blocker **`checks_incomplete`** when truncation occurred, even if visible checks look successful. With repeatable **`--allowed-path`**, **`merge plan`** / MCP **`merge_plan`** may add **`path_scope_violation`** or **`changed_paths_unavailable`** (see **`cr files`** above). **`cr inventory`** fails closed with **`inventory_list_incomplete`** when the open-PR list cannot be proved complete within **`open_pull_list`** bounds; when the forge exposes a trusted total count above **`compliant_max_items`**, inventory fails closed without full pagination. Success packets include **`slice_sort`** and per-entry **`checks_truncated`**.

**`provider capabilities --json`** advertises **`cr_files`** and **`cr_comments`** per provider with honest **`implemented`** flags — Gitea, GitHub, and GitLab API providers implement both; stub providers report **`implemented: false`**.

Multi-source providers (GitHub, GitLab) expose **`check_source_count`**, **`compliant_max_items_total`**, and **`truncation_combination: any_source_truncated`** in **`check_pagination`** — truncation is true when any source hits the page cap.

GitHub Link **`rel=next`** pagination follows only same-origin URLs whose **pathname matches the current request** (strict equality); callers must pass **`resolveBase`** (current request URL) — omitted base fails closed; **userinfo in Link URLs or resolveBase is rejected**; off-path same-origin links are rejected so bearer tokens are not sent to unrelated API paths.

### Auth class matrix (API providers)

| Command | `auth_class` | Notes |
|---------|--------------|-------|
| `repo_status` | `none` | Runs without a token; default branch and full capability list require auth |
| `ref_compare` | `git_only` | Resolves refs and ahead/behind via local git |
| `sync_plan` | `git_only` | Compares local and remote-tracking SHAs via git |
| `pr_status` | `token_required` | Forge REST/GraphQL |
| `pr_checks` | `token_required` | Forge check/status APIs (ref mode still needs token for check fetch) |
| `merge_plan` | `token_required` | Composes PR view and checks; optional path scope via **`--allowed-path`** |
| `cr_files` | `token_required` | PR/MR changed-path list for merge-plan path scope |
| `cr_comments` | `token_required` | PR/MR review comments with sanitized bodies |
| `forge_changes` | `token_required` | PR/MR lifecycle and check deltas since `--since` |
| `cr_open` | `token_required` | Open pull/MR (Gitea only; requires **`write_commands`**) |
| `status_set` | `token_required` | POST commit status (requires **`write_commands`**) |
| `whoami` | `token_required` | Authenticated forge identity |
| `branch_protection` | `token_required` | Branch protection policy facts |

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


## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
