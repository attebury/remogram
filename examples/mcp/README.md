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

`doctor`, `provider_capabilities`, `repo_status`, `ref_compare`, `ref_inventory`, `cr_inventory`, `whoami`, `branch_protection`, `cr_files`, `cr_comments`, `forge_changes`, `cr_open`, `status_set`, `merge_execute`, `pr_status`, `pr_checks`, `merge_plan`, `sync_plan` — same JSON as `remogram … --json`.

**Write tools (`cr_open`, `status_set`, `merge`):** require the matching id in `.remogram.json` **`write_commands`**. Each id is a separate opt-in — **`cr_open` alone does not enable `merge_execute`**. Otherwise MCP returns **`write_not_configured`** — use forge/CI outside Remogram or add the id to opt in. **`merge_plan`** is read-only and does not execute merges.

## If `remogram-mcp` is not on PATH

Use Node with an absolute path to the server entry:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/remogram/packages/remogram-mcp/bin/remogram-mcp.js"]
}
```

Set `REMOGRAM_CWD` to the **absolute path** of the consumer repo root (required for Claude Desktop; recommended everywhere).
