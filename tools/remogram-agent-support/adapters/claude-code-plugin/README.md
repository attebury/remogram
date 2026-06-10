# Claude Code plugin adapter

Install into your Claude Code plugins directory:

```bash
./scripts/install-agent-skills.sh --claude ~/.claude/plugins/remogram-agent-support
```

Or symlink this folder after populating `skills/` via the install script.

For **skills only** (no plugin manifest, rules, or MCP), use [`npx skills`](https://github.com/vercel-labs/skills):

```bash
npx skills add attebury/remogram --skill remogram-consumer -g -a claude-code -y
```

Canonical skill sources: `../../skills/`. Edit those files, then re-run the install script or `npx skills update`.

MCP wiring (separate from skills): [examples/mcp/claude-code.md](../../../../examples/mcp/claude-code.md).
