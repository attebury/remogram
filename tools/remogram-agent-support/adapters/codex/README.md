# Codex

Codex loads skills from `~/.codex/skills/<skill-name>/SKILL.md`.

## Install from remogram repo

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

Add `remogram-dogfood` only when working in the remogram repository itself:

```bash
cp -R "$REPO/tools/remogram-agent-support/skills/remogram-dogfood" "$SKILLS/"
```

Restart or start a new Codex session so skill descriptions refresh.

## Consumer repos

For day-to-day forge work in other projects, **`remogram-consumer`** alone is usually enough. Install it globally once; enable remogram MCP in that project's Cursor/Codex config separately.
