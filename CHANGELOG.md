# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

## [0.1.0-beta.11] - 2026-06-24

### Added

- **CLI help before validation:** `--help` / `-h` on write commands renders usage before forge config load ([#586](http://localhost:3000/attebury/remogram/issues/586))
- **`cli-help.js`:** static usage registry for `cr open`, `issue open`, `status set`, `merge execute`, and read commands

### Changed

- **Write-field truncation policy:** capped forge write bodies/titles fail closed with `WRITE_FIELD_TRUNCATED` before provider POST ([#585](http://localhost:3000/attebury/remogram/issues/585))
- **Merge execute after facts:** post-merge integration SHA readback when merge POST omits SHAs; `post_merge_readback` metadata on success packets ([#587](http://localhost:3000/attebury/remogram/issues/587))

### Fixed

- **Public export:** skip dogfood Gitea gate contract tests in export tree ([#584](http://localhost:3000/attebury/remogram/pulls/584))

## [0.1.0-beta.10] - 2026-06-23

### Added

- **Operator write authority overlay:** bind `REMOGRAM_OPERATOR_CONFIG` for forge write commands outside tracked `.remogram.json` ([#563](http://localhost:3000/attebury/remogram/issues/563))
- **Configurable forge write field cap:** cap oversized forge write payloads with trusted-repo opt-out ([#569](http://localhost:3000/attebury/remogram/issues/569), [#568](http://localhost:3000/attebury/remogram/issues/568))
- **Gitea issue open ingest projection:** project large issue-create responses through the pull ingest path ([#572](http://localhost:3000/attebury/remogram/issues/572))
- **Gitea `cr_open` ingest projection:** route POST and idempotency list reads through pull ingest projection ([#574](http://localhost:3000/attebury/remogram/issues/574))

### Changed

- **`cr_open` ingest naming:** clarify pull ingest cap field names and add redirect regression test ([#580](http://localhost:3000/attebury/remogram/issues/580))
- **Merge lane docs:** require post-merge lane worktree refresh in merge skills ([#567](http://localhost:3000/attebury/remogram/issues/567))

### Fixed

- **Gitea CI gate:** resolve dogfood integration base as `origin/remo` first instead of failing when `origin/main` is absent ([#582](http://localhost:3000/attebury/remogram/pulls/582))
- **Dogfood SDLC records:** repair records blocking `topogram check` ([#565](http://localhost:3000/attebury/remogram/issues/565))
- **Public export:** skip dogfood skill parity test in export tree (maintainer-only paths stripped)

## [0.1.0-beta.9] - 2026-06-19

### Added

- **`merge_policy` in `.remogram.json`:** opt-in `allow_missing_checks` and `allow_pending_checks` relax `checks_missing` / `checks_pending` blockers on merge plan, merge execute, and cr inventory; env overrides `REMOGRAM_ALLOW_MISSING_CHECKS` and `REMOGRAM_ALLOW_PENDING_CHECKS`; doctor `merge_policy` warn check ([#527](http://localhost:3000/attebury/remogram/issues/527))
- **`cr inventory` cursor contract:** opaque cursor pagination (`--cursor`, MCP `cursor`); `has_more`, `complete`, and `next_cursor` on inventory packets; cursorless callers remain fail-closed on `list_truncated` ([#508](http://localhost:3000/attebury/remogram/issues/508))
- **`forge changes` polling cursor:** opaque cursor pagination on CLI/MCP for agent-safe activity event paging without raising ingest caps ([#511](http://localhost:3000/attebury/remogram/issues/511))
- **`remogram issue open` (Gitea):** `issue_open` write command and `issue_opened` packet; opt-in via `"write_commands": ["issue_open"]`; title-based idempotency scan before POST ([#514](http://localhost:3000/attebury/remogram/issues/514))
- **Agent idempotency keys:** `--idempotency-key` on CLI/MCP for `cr_open` and `status_set`; per-repo scope binding with conflict detection; fingerprint and `created` / `reused_existing` on write packets ([#512](http://localhost:3000/attebury/remogram/issues/512))
- **Doctor write readiness:** per-command `write_config` matrix (`provider_supported`, `configured`, `auth_present`, `ready`, `next_config_snippet`) on doctor body and checks ([#510](http://localhost:3000/attebury/remogram/issues/510))
- **Doctor `--live`:** opt-in forge API reachability probes with `failure_kind` mapping on Gitea/GitHub/GitLab providers ([#528](http://localhost:3000/attebury/remogram/issues/528))
- **Merge plan check diagnostics:** `required_contexts` and missing/failed/pending/stale context fields on `pr checks` and matching merge plan blockers ([#509](http://localhost:3000/attebury/remogram/issues/509))

### Changed

- **Capability honesty:** provider capabilities and doctor checks report implemented vs stub behavior more accurately; regression harness for status-set opt-out docs ([#457](http://localhost:3000/attebury/remogram/issues/457), [#459](http://localhost:3000/attebury/remogram/issues/459))
- **Write-command docs:** clarify `cr_open` vs `merge execute` boundaries in consumer/core skills ([#432](http://localhost:3000/attebury/remogram/issues/432))
- **Consumer skill:** Runlane CLI friction guidance for cross-tool operator reporting ([#549](http://localhost:3000/attebury/remogram/issues/549))

### Fixed

- **Merge execute follow-ups:** shared `pr_status` contract keys across tests; preserve `invalid_args` from `branchHeadSha` in merge execute dispatch; MCP fork-PR branch URL integration coverage ([#530](http://localhost:3000/attebury/remogram/issues/530), [#531](http://localhost:3000/attebury/remogram/issues/531), [#532](http://localhost:3000/attebury/remogram/issues/532))
- **Gitea `pr view` cap-proof:** strip bulky pull fields before agent-safe ingest cap check; bounded 256KiB raw read for pull view ([#478](http://localhost:3000/attebury/remogram/issues/478))
- **`cr inventory` provider pagination:** follow-up fixes for probe fallback and partial pagination walks ([#353](http://localhost:3000/attebury/remogram/issues/353))

## [0.1.0-beta.8] - 2026-06-18

### Added

- **`remogram merge execute`:** Gitea-first forge merge write command with SHA-bound fail-closed preflight (`--expected-base-sha`, `--expected-head-sha`, `--method merge`); emits `cr_merged` or `cr_merge_blocked` packets; MCP `merge_execute` tool with `destructiveHint: true`; opt-in via `"write_commands": ["merge"]` in `.remogram.json` ([#507](http://localhost:3000/attebury/remogram/issues/507))

### Changed

- **`merge execute` preflight:** reconciles head against live forge branch tip via Gitea `/branches/{ref}` (runner-agnostic; no local head checkout required); removes `local_head_missing` / `stale_head` blockers; adds `head_ref_moved`, `head_ref_unreadable`, `head_ref_unverified`, `head_ref_missing`, `head_ref_invalid`, `checks_head_sha_mismatch`, `checks_forge_head_mismatch`, and `forge_pr_head_mismatch`; `before.forge_head_ref_sha` and `before.checks_head_sha` in blocked/merged packets; validates `head_ref` before branch read; fail-closed when provider lacks `branchHeadSha`; invalid `--expected-*-sha` and malformed `head_ref` map to `invalid_args`
- **`merge execute` (Gitea):** fork PR branch reads use `pull.head.repo` (`forge_source_repo_id` optional on `pr_status`); SHA-40 validation on branch tips; broader 409 head-mismatch detection (`sha mismatch`); removed redundant `merge_plan_blockers_present` preflight blocker
- **CLI error handling:** `handleError` maps thrown `invalidArgs` to `error_code: invalid_args` (merge execute expected SHAs and shared ref validation)
- **TOCTOU note:** merge execute sends reviewed `--expected-head-sha` as Gitea `head_commit_id` on merge POST; forge returns 409 `head out of date` when the PR head moved after preflight (`head_ref_moved`)
- **`merge plan`** unchanged; shared merge blocker helpers reused by merge execute preflight
- **Write opt-in docs:** document `merge` alongside `cr_open` in consumer/core skills and README

## [0.1.0-beta.7] - 2026-06-18

### Added

- **`base_url` envelope field:** host-verified forge origin on all Remogram packets via shared `forge-identity` normalization ([#515](http://localhost:3000/attebury/remogram/issues/515))

### Changed

- **Breaking:** PR/CR packets rename `base_ref`/`head_ref`/`base_sha`/`head_sha` to `forge_target_*` / `forge_source_*`; ref compare uses `compare_base_*` / `compare_head_*` ([#516](http://localhost:3000/attebury/remogram/issues/516))

### Fixed

- **Review follow-up:** strip body-injected `base_url`; restore GitLab API fixture shape; negative PR/ref_compare field separation tests; MCP/CLI `base_url` parity; align package versions with CHANGELOG beta.7

## [0.1.0-beta.6] - 2026-06-17

### Fixed

- **Merge plan hardening:** fail-closed path scope, forge transport invariants, and adversarial review follow-ups across merge-plan and merge-plan-forge
- **Security hardening (code review):** provider write gate, ingest cap bounds, merge plan fail-closed defaults
- **Path allowlist:** block `..` and traversal edge cases in [`packages/remogram-core/path-allowlist.js`](packages/remogram-core/path-allowlist.js)

## [0.1.0-beta.4] - 2026-06-14

### Fixed

- **CR inventory probe fallback:** reuse page-one probe body on pagination fallback (Gitea/GitLab/GitHub) — avoids duplicate page-1 forge fetch ([#348](http://localhost:3000/attebury/remogram/issues/348))
- **Gitea `recent_created` tail failure:** tail-only pagination fallback instead of page-1 oldest slice
- **`list_truncated` vs trusted `entry_count`:** partial pagination walks with trusted forge total now set `list_truncated: true`
- **CR inventory probe fallback:** preserve trusted forge `entry_count` (header/search total) when fast path rejects and pagination fallback runs
- **Gitea `recent_created` when total exceeds limit:** fetch `sort=oldest` tail page for globally newest-created slice
- **Gitea/GitLab number sorts when total exceeds limit:** full-list collect within compliant max before client sort and slice
- **GitHub fallback:** include search `total_count` as `entry_count` when fast path rejects
- **`cr inventory --sort recent_created` (Gitea):** map to `sort=oldest` and reverse page order so it differs from `recent_update`
- **Open-PR fast path:** reject header/body length mismatch; skip fast path for `number_asc` / `number_desc` when total open count exceeds `--limit` (fallback to pagination)
- **CR open scan hardening:** idempotency scan ingest backoff; allowlisted/validated `forge_error` trusted fields; `idempotency_scan` in provider capabilities; default-cap scan regression tests
- **CR open polish:** dedicated open-pull idempotency pagination caps; `idempotency_scan` metadata on `idempotency_scan_incomplete`; packet contract for `reused_existing`; CLI/MCP truncated-scan integration tests; Observer retry docs
- **CR open review follow-up:** paginated fail-closed idempotency scan (`idempotency_scan_incomplete`); `reused_existing` on idempotent packets; write-command enum DRY; MCP/doctor negative tests; consumer CLI/MCP write boundary docs
- **CR open hardening:** idempotent open for matching head+base; structured `unparseable_provider_output` for invalid provider pull numbers; MCP `destructiveHint` on `cr_open`; expanded provider/CLI/MCP tests
- **CR inventory default bound:** when `--limit` is omitted, inventory uses `DEFAULT_CR_INVENTORY_SAFE_LIMIT` (3) instead of 50 so default `cr inventory --json` avoids top-level `oversized_raw_output` on large open-PR payloads; explicit `--limit` unchanged up to 50

### Added

- **`cr inventory --sort`:** opt-in normalized slice sort presets (`number_asc` default, `number_desc`, `recent_update`, `recent_created`); success packets include trusted `slice_sort`
- **Open-PR list fast path:** Gitea/GitLab use forge total-count headers; GitHub uses Search API `total_count` when `incomplete_results` is false — default `cr inventory` avoids full open-list pagination when count is provable
- **`remogram cr open`:** Gitea-first write path to open change requests; emits `change_request_opened` packet with trusted envelope; MCP `cr_open` tool with `readOnlyHint: false`

### Changed

- **Public docs Topogram audit:** neutralize Topogram in public skills, README, and agent-support README; strip maintainer blocks on export; denylist `tools/gitea` and adapter maintainer rule; add public Topogram allowlist regression test
- **Maintainer docs:** [docs/deferred-follow-ups.md](docs/deferred-follow-ups.md) indexes deferred functional follow-ups (e.g. #353 `cr inventory` probe fallback)
- **`open_pull_list` capabilities:** document `default_slice_sort`, `supported_slice_sorts`, and provider-specific `total_count_source` / `total_count_header`
- **`paginateOffsetListPages`:** `listLimit` branch probes page+1 at maxPages (fixes false `list_truncated` at exact compliance boundary)
- **Write opt-in:** `write_commands` in `.remogram.json` required for `cr open` (fail closed with `write_not_configured`); doctor warns when provider supports writes but config does not opt in
- **Docs:** beta.0–beta.4 read/plan by default; incremental write wiring; opt-out bridge table (Gitea shim, gh/glab manual)
- Envelope gate error text uses neutral workflow/planning-tool wording (no Topogram naming in npm output)

## [0.1.0-beta.3] - 2026-06-14

### Added

- **Semantic diff fact inventory:** `ref inventory`, `cr inventory`, and related read-only packets for Topogram consumer workflows; contract tests and provider matrix coverage
- **CR inventory hardening:** single-pass aggregation, semantic SHAs and stale-head hints, entry bounds and truncation metadata, partial failure resilience
- **CR inventory `--limit`:** provider open-PR list requests honor inventory limit before ingest (fixes `oversized_raw_output` on large repos when using `--limit 1`)
- **Forge trust rounds 6–14:** check pagination across providers, ingest backoff and list truncation signaling, GitHub/GitLab Link header handling, pathname confinement, doctor and public-export script hardening, adversarial provider tests
- **Gitea commit status normalization:** map Gitea `status` field with `state` fallback; dedupe duplicate contexts (latest row wins); fail-closed unknown values in `prChecks`
- **Gitea CI gate workflow** for dogfood PR checks

### Changed

- Expanded test coverage for cr inventory CLI integration, provider matrix metadata, and forge-trust regression suites (366 tests on release tip)

### Fixed

- Gitea `prChecks` reading wrong field (`status` vs `state`) and stale duplicate context rows overriding newer success
- `pr_not_open` entries recorded in `entries_skipped` when inventory skips non-open PRs
- Multiple forge-trust issues from rounds 6–14 (pagination bounds, ingest cap backoff, export script defaults, stub doctor honesty, and related provider edge cases)

## [0.1.0-beta.2] - 2026-06-11

### Changed

- **Forge trust round 5 (waves 1–4):** `stale_head` when PR-by-number forge `forge_source_sha` diverges from local git; `.remogram.json` discovery bounded to repository git root; per-command `auth_class` in `provider capabilities` and README auth matrix; doctor honesty for stub/misconfig; documented MCP vs core vitest coverage policy with drift guards in `tests/core/coverage-config.test.mjs`

### Fixed

- Overclaimed SHA-bound language in README and skills (wave 1)
- Parent-directory `.remogram.json` pickup from nested cwd (wave 2)
- Capabilities implying token required for git-only commands; stub providers passing doctor clean (wave 3)

## [0.1.0-beta.1] - 2026-06-11

### Changed

- **Forge trust round 4 (waves 1–4):** packet trust doctrine in AGENTS.md and agent skills (envelope trusted, forge string leaves untrusted); `remogram doctor` fail-closed (exit code 1 and `ok: false` when checks fail); `sanitizeUrl` strips URL userinfo; check pagination for GitHub, GitLab, and Gitea; Gitea check/PR state normalization; forge ingest cap in provider capabilities with optional env override warn; CONFIG_INVALID for disallowed config fields; MCP `pr_checks` schema validation; centralized core secret redaction; `refs compare` without forge token on API providers; stub provider doctor warn; export denylist regression test
- Agent skill install docs: [`npx skills`](https://github.com/vercel-labs/skills) alongside `./scripts/install-agent-skills.sh`
- `remogram-dogfood` marked `metadata.internal: true` (hidden from default `npx skills` discovery)

### Fixed

- Public export preflight failure when `export-public-main.sh` strips `dogfood-skills.list` before `npm test` in the export tree (PR #56)

## [0.1.0-beta.0] - 2026-06-10

### Added

- Public beta of `@remogram/cli` and `@remogram/mcp` on npm (`beta` tag)
- Read/plan forge facts: `repo status`, `ref compare`, `pr view`, `pr checks`, `merge plan`, `sync plan`
- Providers: `gitea-api`, `github-api`, `gitlab-api` (REST adapters)
- MCP stdio server with tools matching CLI JSON packets
- MCP config examples for Cursor, Claude Desktop, OpenAI Codex, and Claude Code (`examples/mcp/`)
- Agent skills: `remogram-consumer` and `remogram-core` (`tools/remogram-agent-support/`)

### Known limits (beta)

- Read/plan only — no PR create, merge execute, or push
- `github-gh` and `gitea-tea` provider IDs are reserved CLI-wrapper placeholders (not implemented); use `*-api` providers — GitLab's CLI is `glab` but has no wrapper ID yet (see README)
- Payload-size smoke compare is not packaged in npm beta (monorepo dev tooling only)

[0.1.0-beta.11]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.11
[0.1.0-beta.10]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.10
[0.1.0-beta.9]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.9
[0.1.0-beta.8]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.8
[0.1.0-beta.4]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.4
[0.1.0-beta.3]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.3
[0.1.0-beta.2]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.2
[0.1.0-beta.1]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.1
[0.1.0-beta.0]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.0
