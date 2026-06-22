# Remogram

Generic SCM/forge boundary CLI and MCP server. Emits provider-attributed JSON facts with SHA fields where applicable — **git-resolved** refs from local git (`refs compare`, `sync plan`) vs **forge-reported** PR SHAs from forge APIs (`pr view`, `pr checks`) — and no workflow or planning-tool concepts in output.

**PR-by-number reconciliation:** When `pr view` or `pr checks` is invoked with `--number`, Remogram compares the forge-reported `forge_source_sha` to the locally resolved git rev for `forge_source_branch_ref` (typically `<remote>/<forge_source_branch_ref>`). If they diverge, the packet is `ok: false` with `error_code: stale_head` and portable head refs — treat that as a signal to `git fetch`, not a forge outage.

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

- **Read/plan by default** — **`write_commands`** in `.remogram.json` opts in to Remogram CLI/MCP writes (`cr_open` on Gitea; `status_set` on Gitea/GitHub/GitLab; `merge` for Gitea **`merge execute`**). Unlisted writes → `write_not_configured` → use forge/CI on your system.
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
3. **One backend per forge for v1** — `github-api`, `gitea-api`, and `gitlab-api` implement the shared read/plan command surface with normalized packet shapes. Wrappers would duplicate that surface without adding new commands in beta.
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
  "write_commands": ["cr_open", "status_set", "merge"]
}
```

Optional **`merge_policy`** (opt-in; default fail-closed) relaxes check blockers on **`merge plan`**, **`merge execute`**, and **`cr inventory`** entry aggregation for repos with no CI:

```json
"merge_policy": {
  "allow_missing_checks": true,
  "allow_pending_checks": true
}
```

Env overrides (trusted local runners only): `REMOGRAM_ALLOW_MISSING_CHECKS=1`, `REMOGRAM_ALLOW_PENDING_CHECKS=1`. `remogram doctor --json` warns when enabled. **`checks_conclusion` remains observational; `blockers[]` is authoritative.**

**Write opt-in:** Remogram defaults to read/plan. To enable writes, add **`write_commands`** in `.remogram.json`. **`cr open`** (Gitea first) requires `"cr_open"`. **`merge execute`** (Gitea first, `--method merge` only) requires `"merge"`. Without opt-in, write commands fail closed with `write_not_configured`. **Use CLI or MCP for writes** — direct provider package imports bypass the consumer gate (maintainer/tests only). **`merge execute`** re-reads view/checks/plan, cross-checks view/checks/forge head SHAs, verifies the live forge head branch tip matches **`--expected-head-sha`**, and requires **`--expected-base-sha`** / **`--expected-head-sha`** before forge POST; the Gitea merge POST includes **`head_commit_id`** pinned to the expected head SHA (forge 409 → `head_ref_moved` if the branch moved after preflight). For **fork PRs**, branch tip reads use `pull.head.repo` (Gitea pull payloads must include `head.repo` for fork detection); the forge token must have access to the head repository or preflight fails closed with `head_ref_unreadable`. When `head.repo` is absent, merge execute reads the configured repository branch instead. Emits **`cr_merged`** or **`cr_merge_blocked`**. Re-run with a fresh reviewed SHA if preflight or forge POST blocks. For **`cr open`**, read idempotency scan limits from **`remogram provider capabilities --json`** (`idempotency_scan.max_pages`, `page_size`, `ingest_backoff`) before opening CRs.

**Write command boundaries:** Each write id is a separate opt-in. Enabling **`cr_open` alone does not enable merge execution** — add **`merge`** for **`merge execute`**. Inspect configured vs supported writes with **`remogram provider capabilities --json`** and **`remogram doctor --json`** (`write_config`). **`merge plan` does not execute or authorize merges** — it reports forge readiness facts (`mergeability`, `checks_conclusion`, `blockers[]`). Empty **`blockers[]`** is not workflow merge authority; pending, missing, or failed checks and non-empty blockers remain fail-closed unless your repo opts in via **`merge_policy`**.

| Command / surface | Mutates forge? | Requires in `write_commands` | Notes |
|-------------------|----------------|------------------------------|-------|
| `cr open` / `cr_open` | yes (create CR) | `cr_open` | Gitea v1; separate from merge |
| `merge execute` / `merge_execute` | yes (merge CR) | `merge` | Gitea v1; not implied by `cr_open` |
| `merge plan` | no | none (read/plan) | Reports `blockers[]`; does not execute merge |
| `provider capabilities`, `doctor` | no | n/a | Inspect configured vs supported writes |

**Opt-out bridges (not Remogram packets):** When **`write_commands`** omits a write id, post via your forge outside Remogram — reads (`pr checks`, `merge plan`, etc.) still work.

- **CR/PR create:** Gitea dogfood may use the control-plane `open-gitea-change-request.mjs` script; GitHub/GitLab use `gh pr create` / `glab mr create`.
- **Commit status set:** use forge-native APIs when **`status_set`** is not configured — e.g. GitHub `gh api repos/{owner}/{repo}/statuses/{sha}`, GitLab commit status API via `glab api`. Remogram still **reads** commit statuses through **`remogram pr checks`** regardless of write opt-in.

## Workflow fields not in packets

Remogram emits **forge facts only** — no workflow metadata in CLI/MCP output. These fields are **intentionally absent** (by design, not omission):

- `canonical_integration_ref`, `local_merge_branch`, `candidate_transport_ref`
- `lane`, `goal_branch`, `sdlc_task`, `next_actor`, `safe_for_merge_lane`
- Runlane registry/runtime and handoff fields (`reviewed_candidates`, `lane_handoff_packet`, …)

Downstream lane tools (Runlane registry, Review/Merge Lane policy) **compare** Remogram forge refs to configured authority outside Remogram.

## Authority vs forge refs

| Concept | Remogram packet | Notes |
|---------|-----------------|-------|
| PR base (forge-reported) | `forge_target_branch_ref` | Shared term `term_forge_target_branch_ref` (Runlane #146) |
| PR head (forge-reported) | `forge_source_branch_ref` | Evidence only |
| Repo default branch | `default_branch` on `repo status` | **Not** integration authority |
| Ref compare | `compare_base_ref`, `compare_head_ref` | On `refs compare` only — not on PR packets |

A PR’s forge target may be `main` while configured integration authority is `origin/remo` or `gitea/main`. Lanes compare `pr view` forge target to `canonical_integration_ref` in Runlane registry or repository overlay — **outside** Remogram. Do not rename Remogram packet fields to workflow vocabulary.

Cross-layer terminology: [Runlane #146](http://localhost:3000/attebury/runlane/issues/146) (SHARED-TERMINOLOGY deliverable).

## Lane registry (Runlane v2)

Remogram lane work uses Runlane registry **version 2** with `canonical_integration_ref` and `local_merge_branch` only — reject v1 keys (`integration_ref`, `queue_base`, `merge_branch`).

Operator paths (local, not committed with thread bindings):

- `~/Documents/lanes/remogram/lane-registry.local.json`
- `~/Documents/lanes/remogram/remogram-remo-v1.json` (profile catalog v2)

Validate: `node ~/Documents/lanes/scripts/validate-lane-registry.mjs ~/Documents/lanes/remogram/lane-registry.local.json`

## Commands (beta — read/plan default; incremental writes)

```bash
remogram provider capabilities --json
remogram doctor --json
remogram repo status --json
remogram refs compare --base main --head feature/x --json
remogram pr view --number 1 --json
remogram pr checks --number 1 --json
remogram merge plan --number 1 --json
remogram sync plan --remote origin --json
# Gitea only, requires write_commands in .remogram.json:
remogram cr open --head feature/x --base main --title "My change" --json
remogram merge execute --number 1 \
  --expected-base-sha <base-sha> --expected-head-sha <head-sha> \
  --method merge --json
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
3. **MCP:** tools `doctor`, `provider_capabilities`, `repo_status`, `ref_compare`, `ref_inventory`, `cr_inventory`, `pr_status`, `pr_checks`, `merge_plan`, `merge_execute`, `sync_plan` return the same JSON. See [examples/mcp/README.md](examples/mcp/README.md).
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

**`forge changes`** emits **`forge_changes`** with **`since`** (the requested ISO-8601 boundary), **`since_kind: "observed_at"`**, **`events[]`** (kinds: **`pr_opened`**, **`pr_closed`**, **`pr_merged`**, **`forge_source_sha_moved`**, **`checks_conclusion_observed`**), **`event_count`**, and **`events_truncated`** when the provider list exceeds the product cap (256 events) or pagination stops before a complete list. Requires **`--since <ISO-8601>`** and forge token auth (`token_required`). Gitea, GitHub, and GitLab each derive events from pull/MR activity since the boundary; PR titles and URLs in events are sanitized and remain semantically untrusted forge strings.

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

`remogram provider capabilities --json` returns structured provider facts: which commands are implemented, per-command **`auth_class`**, auth env names, check sources, mergeability confidence, host binding, pagination, **`check_pagination`**, **`idempotency_scan`** (cr open scan limits and backoff), **`open_pull_list`** (cr inventory list bounds, slice sort presets, and total-count source on Gitea/GitLab/GitHub), `forge_ingest_cap_bytes`, **`write_support`** (provider capability), and optional **`write_commands`**. Consumer **`.remogram.json`** must list **`write_commands`** to enable writes (fail closed otherwise).

**`pr checks`** / MCP **`pr_checks`** include **`checks_truncated`** when check enumeration stops at the provider page cap (conservative fail-closed: true when exactly `page_size × max_pages` items were returned, even if no further forge pages exist). **`merge plan`** adds blocker **`checks_incomplete`** when truncation occurred, even if visible checks look successful. **`cr inventory`** fails closed with **`inventory_list_incomplete`** when the open-PR list cannot be proved complete within **`open_pull_list`** bounds; when the forge exposes a trusted total count above **`compliant_max_items`**, inventory fails closed without full pagination. Success packets include **`slice_sort`** and per-entry **`checks_truncated`**.

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


## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
