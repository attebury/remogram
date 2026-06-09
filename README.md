# remogram

Generic SCM/forge boundary CLI and MCP server. Emits provider-attributed, SHA-bound JSON facts only — no Topogram or SDLC concepts in output.

Sibling to [Topogram](https://github.com/attebury/topogram): Topogram models remogram in `topo/` during development; remogram has **no Topogram runtime dependency**.

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

Copy `.remogram.json.example` to your repo root. Auth via `GITEA_TOKEN` (gitea-api provider).

## Commands (v1 — read/plan only)

```bash
remogram repo status --json
remogram refs compare --base main --head feature/x --json
remogram pr view --index 1 --json
remogram pr checks --index 1 --json
remogram merge plan --index 1 --json
remogram sync plan --remote origin --json
```

## MCP

```bash
./scripts/npm-link.sh              # remogram-mcp on PATH
./scripts/install-project-mcp.sh     # copies .cursor/mcp.json.example → .cursor/mcp.json
```

Reload MCP in Cursor (Settings → MCP). Tools: `repo_status`, `ref_compare`, `pr_status`, `pr_checks`, `merge_plan`, `sync_plan`.

Each tool returns the same JSON as `remogram ... --json`. Set `GITEA_TOKEN` in your environment.

## SDLC (development)

```bash
topogram work start task_remogram_core . --actor <you> --write --json
topogram sdlc prep commit . --json
```

See [AGENTS.md](AGENTS.md).

## Packages

| Package | Role |
|---------|------|
| `remogram-core` | Envelope, config, caps, HTTP utils |
| `remogram-cli` | CLI surface |
| `remogram-mcp` | MCP stdio adapter (delegates to CLI) |
| `provider-gitea-api` | Gitea REST adapter |
| `provider-*` stubs | Proposed providers → `provider_unsupported` |
