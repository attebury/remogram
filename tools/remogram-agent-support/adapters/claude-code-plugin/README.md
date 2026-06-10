# Claude Code plugin adapter

Install into your Claude Code plugins directory:

```bash
./scripts/install-agent-skills.sh --claude ~/.claude/plugins/remogram-agent-support
```

Or symlink this folder after populating `skills/` via the install script.

Canonical skill sources: `../../skills/`. Edit those files, then re-run the install script.

MCP wiring (separate from skills): [examples/mcp/claude-code.md](../../../../examples/mcp/claude-code.md).
