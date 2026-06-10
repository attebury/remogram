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
remogram pr view --number 1 --json
remogram pr checks --number 1 --json
remogram merge plan --number 1 --json
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

## Testing

```bash
npm test              # full suite
npm run test:coverage # remogram-core coverage report
```

| Layer | Location | What runs | Git required |
|-------|----------|-----------|--------------|
| Core unit | `tests/core/` | Envelope, caps, `assertForgeReady`, HTTP, packet contracts | Temp repos in `resolve.test.mjs` only |
| Provider | `tests/provider/` | Gitea adapter with mocked `fetch` + JSON fixtures | One test resolves refs via local git |
| CLI integration | `tests/cli/` | All six commands via `runCli` with temp `.remogram.json` and injected mock provider; default `PROVIDERS` wiring in `default-providers.test.mjs` | Temp git repo per test |
| MCP | `tests/mcp/` | `packetToMcpContent` unit tests + stdio server smoke | Smoke uses repo cwd |

- Tests live under `tests/**/*.test.mjs` only.
- `dx/` agent progress logs are **excluded** from test and coverage scope.
- `runCli(argv, { cwd, providers })` accepts `options.providers` **for tests only** — production CLI and MCP spawn use the built-in `PROVIDERS` map; do not inject providers in app code.
- Coverage (`npm run test:coverage`) reports **`packages/remogram-core`** only — not MCP or provider packages.
- **CI:** GitHub Actions (`.github/workflows/test.yml`) runs on push/PR when hosted on GitHub. For local **Gitea**, mirror workflow lives at `.gitea/workflows/test.yml` (same steps: Node 20, stub Topogram sibling, `npm ci`, `npm test`, `npm run test:coverage`). Gitea Actions may require enabling workflows in server settings.
- **Lane checks:** `remogram pr checks` reads forge commit statuses. On local Gitea without Actions/status posting, `check_conclusion: "missing"` is expected. In that mode, lanes still use remogram for PR facts and mergeability, then require local proof (`topogram check . --json`, `npm test`) before merge. Missing statuses are not a substitute for failed statuses; if the forge reports failure or pending, treat that as a blocker.

## Packages

| Package | Role |
|---------|------|
| `remogram-core` | Envelope, config, caps, HTTP utils |
| `remogram-cli` | CLI surface |
| `remogram-mcp` | MCP stdio adapter (delegates to CLI) |
| `provider-gitea-api` | Gitea REST adapter |
| `provider-*` stubs | Proposed providers → `provider_unsupported` |
