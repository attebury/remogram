# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

## [0.1.0-beta.6] - 2026-06-17

### Fixed

- **Merge plan hardening:** fail-closed path scope, forge transport invariants, and adversarial review follow-ups across merge-plan and merge-plan-forge
- **Security hardening (code review):** provider write gate, ingest cap bounds, merge plan fail-closed defaults
- **Path allowlist:** block `..` and traversal edge cases in [`packages/remogram-core/path-allowlist.js`](packages/remogram-core/path-allowlist.js)

### Added

- **Test suite guard v3:** modular [`scripts/lib/test-suite-guard/`](scripts/lib/test-suite-guard/), manifest v3 floors (`min_it_by_describe`, `min_expect_by_describe`), CI and Gitea gate integration
- **Manifest shrink guards:** `diff_policy` key/type shrink, `min_lines` numeric hardening, `checkDiff` fail-closed base policy, floor-map residual hardening

### Changed

- **CLI:** command dispatch split into [`packages/remogram-cli/cli-dispatch.js`](packages/remogram-cli/cli-dispatch.js)
- **Docs:** README protected-test suite guidance and implement-lane skill bullets for manifest shrink policy
- **Tests:** 785 tests on release tip (up from 366 at beta.3)

## [0.1.0-beta.5] - 2026-06-15

### Changed

- **Capabilities doc audit:** align `llms.txt`, README beta limits and command inventory, MCP claude-code tool list, and agent skills with beta.4 surface (15 read/plan commands; opt-in `cr_open` / `status_set` via `write_commands`); add `docs/capabilities-doc-audit.md` and `tests/docs/doc-consistency.test.mjs` ([#475](http://localhost:3000/attebury/remogram/issues/475) follow-up)
- **Write policy docs:** unified `write_commands` guidance — listed ids use Remogram CLI/MCP; unlisted writes are forge/CI on your system (not per-command shim catalogs). **`write_not_configured`** and **`doctor`** `write_config` messages updated ([#475](http://localhost:3000/attebury/remogram/issues/475))

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

- **Forge trust round 5 (waves 1–4):** `stale_head` when PR-by-number forge `head_sha` diverges from local git; `.remogram.json` discovery bounded to repository git root; per-command `auth_class` in `provider capabilities` and README auth matrix; doctor honesty for stub/misconfig; documented MCP vs core vitest coverage policy with drift guards in `tests/core/coverage-config.test.mjs`

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

[0.1.0-beta.6]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.6
[0.1.0-beta.5]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.5
[0.1.0-beta.4]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.4
[0.1.0-beta.3]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.3
[0.1.0-beta.2]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.2
[0.1.0-beta.1]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.1
[0.1.0-beta.0]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.0
