# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Fixed

- **CR inventory default bound:** when `--limit` is omitted, inventory uses `DEFAULT_CR_INVENTORY_SAFE_LIMIT` (3) instead of 50 so default `cr inventory --json` avoids top-level `oversized_raw_output` on repos with large open-PR payloads; explicit `--limit` unchanged up to 50

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

[0.1.0-beta.3]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.3
[0.1.0-beta.2]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.2
[0.1.0-beta.1]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.1
[0.1.0-beta.0]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.0
