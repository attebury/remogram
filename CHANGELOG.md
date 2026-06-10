# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Changed

- **Forge trust wave 1:** packet trust split in AGENTS.md and agent skills (envelope trusted, forge string leaves untrusted); `remogram doctor` sets `ok: false` and exit code 1 when checks fail; `sanitizeUrl` strips URL userinfo; public export scripts default secret-scan base to `origin/main` not `origin/remo`
- Agent skill install docs: [`npx skills`](https://github.com/vercel-labs/skills) alongside `./scripts/install-agent-skills.sh`
- `remogram-dogfood` marked `metadata.internal: true` (hidden from default `npx skills` discovery)

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

[0.1.0-beta.0]: https://github.com/attebury/remogram/releases/tag/v0.1.0-beta.0
