# Progress: Remogram MCP wiring (dev/scaffold)

## Approach
Fix MCP→CLI delegation, project Cursor config, integration tests.

## Steps So Far
1. Fixed `run-cli.mjs` CLI bin resolution (`@remogram/cli` export + monorepo fallback).
2. Added `@remogram/cli` dependency to `@remogram/mcp`.
3. Added `scripts/install-project-mcp.sh`, `.cursor/mcp.json` (local).
4. MCP server integration test lists 6 tools; run-cli tests pass.

## Current Status
MCP server starts and lists tools. Reload Cursor MCP to pick up config.

## Current Failure / Open Item
User must reload MCP in Cursor and set GITEA_TOKEN for live forge calls.
