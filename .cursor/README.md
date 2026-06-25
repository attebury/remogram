# Cursor project config

**Cursor only.** MCP server wiring for this IDE.

| File | Purpose |
|------|---------|
| `mcp.json.example` | Template copied to `mcp.json` by `./scripts/install-project-mcp.sh` |

Other agents (Codex, Claude Desktop, Claude Code) use different config paths — see [examples/mcp/README.md](../examples/mcp/README.md).

Do not commit `mcp.json` if it contains secrets; it is gitignored via `.cursor/mcp.json` in `.gitignore` when present.
