# Remogram agent support

Agent-agnostic skill pack for remogram CLI and MCP. Canonical source:

```
tools/remogram-agent-support/skills/
├── remogram-consumer/   # any repo with .remogram.json
├── remogram-core/       # remogram product development
└── remogram-dogfood/    # remogram repo + Topogram SDLC on remo
```

## Install

From the remogram repository root:

```bash
./scripts/install-agent-skills.sh --all
```

| Flag | Target |
|------|--------|
| `--cursor` | `.cursor/skills/` in this repo (dogfood + core) |
| `--codex` | `~/.codex/skills/` (consumer + core; optional dogfood) |
| `--claude ~/.claude/plugins/...` | copy Claude Code plugin adapter |
| `--consumer-only` | install only `remogram-consumer` (+ core) |
| `--all` | cursor + codex consumer/core |

**Cursor (this repo):** project skills under `.cursor/skills/` are synced from canonical sources.

**Codex:** skills under `~/.codex/skills/remogram-*`.

**Claude Code:** use `adapters/claude-code-plugin/` as a local plugin, or copy `skills/` into your plugin directory. Plugin manifest: `.claude-plugin/plugin.json`.

## Which skill to load

| Context | Skill |
|---------|--------|
| Any consumer repo with `.remogram.json` | `remogram-consumer` |
| Editing `packages/remogram-*` or providers | `remogram-core` |
| remogram repo lanes, SDLC, merge to `remo` | `remogram-dogfood` + Topogram lane skills |

## Adapters

| Agent | Path |
|-------|------|
| Cursor | `adapters/cursor/` (rule + sync via install script) |
| Claude Code | `adapters/claude-code-plugin/` |
| Codex | `adapters/codex/README.md` |

Do not edit adapter copies by hand — change canonical `skills/` and re-run the install script.
