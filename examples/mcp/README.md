# Remogram MCP setup examples

Remogram ships a **stdio MCP server** (`remogram-mcp`) that delegates to the CLI. The server is agent-agnostic; each host has its own config file format and location.

## Prerequisites

From the Remogram repo (or after installing packages globally):

```bash
./scripts/npm-link.sh    # Remogram CLI + remogram-mcp on PATH
```

In **consumer repos** (your project with `.remogram.json`), point the server at that repo with `REMOGRAM_CWD` (see each example).

Set the token for your provider in the environment (`GITEA_TOKEN`, `GITHUB_TOKEN` / `GH_TOKEN`, or `GITLAB_TOKEN`).

## Examples in this folder

| File | Host | Install target |
|------|------|----------------|
| [cursor.project.mcp.json.example](./cursor.project.mcp.json.example) | **Cursor** (project) | Copy to `.cursor/mcp.json` or run `./scripts/install-project-mcp.sh` |
| [claude-desktop.mcp.json.example](./claude-desktop.mcp.json.example) | **Claude Desktop** (user) | Merge into OS-specific config (see file header) |
| [codex.project.config.toml.example](./codex.project.config.toml.example) | **OpenAI Codex** (project) | Copy to `.codex/config.toml` (trusted project) |
| [codex.user.config.toml.example](./codex.user.config.toml.example) | **OpenAI Codex** (user) | Merge into `~/.codex/config.toml` |
| [claude-code.md](./claude-code.md) | **Claude Code** (CLI) | `claude mcp add` or project MCP config |

The copy at [`.cursor/mcp.json.example`](../../.cursor/mcp.json.example) matches the Cursor example (install script target). Legacy alias at repo root: `cursor-mcp.example.json` (same content).

## Tools exposed

`doctor`, `provider_capabilities`, `repo_status`, `ref_compare`, `pr_status`, `pr_checks`, `merge_plan`, `sync_plan` — same JSON as `remogram … --json`.

## If `remogram-mcp` is not on PATH

Use Node with an absolute path to the server entry:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/remogram/packages/remogram-mcp/bin/remogram-mcp.js"]
}
```

Set `REMOGRAM_CWD` to the **absolute path** of the consumer repo root (required for Claude Desktop; recommended everywhere).
