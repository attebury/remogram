# Remogram agent support

Agent-agnostic skill pack for Remogram CLI and MCP. Canonical source:

```
tools/remogram-agent-support/skills/
├── remogram-consumer/   # any repo with .remogram.json
├── remogram-core/       # Remogram product development
└── remogram-dogfood/    # Remogram repo + Topogram SDLC on remo
```

## Install

From the Remogram repository root:

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
| Remogram repo lanes, SDLC, merge to `remo` | `remogram-dogfood` + Topogram lane skills |

## Adapters

| Agent | Path |
|-------|------|
| **All MCP hosts** | [`examples/mcp/README.md`](../../examples/mcp/README.md) — Cursor, Claude Desktop, Codex, Claude Code |
| Cursor | `adapters/cursor/` (rule + sync via install script); MCP: `.cursor/mcp.json.example` |
| Claude Code | `adapters/claude-code-plugin/`; MCP: `examples/mcp/claude-code.md` |
| Codex | `adapters/codex/README.md`; MCP: `examples/mcp/codex.*.config.toml.example` |

Do not edit adapter copies by hand — change canonical `skills/` and re-run the install script.
