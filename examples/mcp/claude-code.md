# Claude Code — Remogram MCP

Claude Code registers MCP servers via the **`claude mcp`** CLI (stdio transport). Skills for Remogram live separately under `tools/remogram-agent-support/skills/` — install with `./scripts/install-agent-skills.sh --claude <path>`.

## Prerequisites

```bash
./scripts/npm-link.sh   # remogram-mcp on PATH
```

Export the forge token for your provider. In your **consumer repo** (contains `.remogram.json`):

```bash
export REMOGRAM_CWD="$PWD"   # or set in MCP env below
```

## Option A — CLI (recommended)

From the consumer repo root:

```bash
# Project-scoped (stored with the repo)
claude mcp add --scope project remogram -- remogram-mcp

# Or user-scoped (all projects)
claude mcp add --scope user remogram -- remogram-mcp
```

If your Claude Code version supports env flags, set the consumer repo explicitly:

```bash
claude mcp add --scope project remogram \
  --env REMOGRAM_CWD="$PWD" \
  --env GITHUB_TOKEN="$GITHUB_TOKEN" \
  -- remogram-mcp
```

Verify:

```bash
claude mcp list
```

Inside a session, use `/mcp` to confirm tools are listed.

## Option B — Node path (no global link)

```bash
claude mcp add --scope project remogram -- \
  node /absolute/path/to/remogram/packages/remogram-mcp/bin/remogram-mcp.js
```

Set `REMOGRAM_CWD` to the consumer repo absolute path in the MCP env configuration your Claude Code version supports.

## Tools

Same JSON as `remogram … --json` — 19 MCP tools:

`doctor`, `provider_capabilities`, `repo_status`, `ref_compare`, `ref_inventory`, `cr_inventory`, `whoami`, `branch_protection`, `cr_files`, `cr_comments`, `forge_changes`, `cr_open`, `status_set`, `pr_status`, `pr_checks`, `merge_plan`, `sync_plan`

**Write tools (`cr_open`, `status_set`):** require the matching id in `.remogram.json` **`write_commands`**. Otherwise MCP returns **`write_not_configured`** — use forge/CI outside Remogram or add the id to opt in.

See [Anthropic Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp) for flag names on your installed version.
