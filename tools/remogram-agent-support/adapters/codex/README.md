# Codex

Codex loads skills from `~/.codex/skills/<skill-name>/SKILL.md` (global) or `.agents/skills/` (project, when installed via `npx skills`).

## Install

### Option A — `npx skills`

```bash
npx skills add attebury/remogram --skill remogram-consumer -g -a codex -y
npx skills add attebury/remogram --skill remogram-core -g -a codex -y   # contributors
```

### Option B — install script

```bash
./scripts/install-agent-skills.sh --codex
```

Or manually:

```bash
REPO=~/Documents/remogram   # adjust path
SKILLS=~/.codex/skills
mkdir -p "$SKILLS"
cp -R "$REPO/tools/remogram-agent-support/skills/remogram-consumer" "$SKILLS/"
cp -R "$REPO/tools/remogram-agent-support/skills/remogram-core" "$SKILLS/"
```

Restart or start a new Codex session so skill descriptions refresh.

## Consumer repos

For day-to-day forge work in other projects, **`remogram-consumer`** alone is usually enough. Install it globally once; enable Remogram MCP using the Codex example in [`examples/mcp/`](../../../../examples/mcp/README.md) (project `.codex/config.toml` or `~/.codex/config.toml`).

For Remogram package development, also install **`remogram-core`**.
