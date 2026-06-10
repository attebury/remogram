# Remogram agent support

Agent-agnostic skill pack for Remogram CLI and MCP. Canonical source:

```
tools/remogram-agent-support/skills/
├── remogram-consumer/   # any repo with .remogram.json
└── remogram-core/       # Remogram product development (packages, providers, tests)
```

## Install

From the Remogram repository root:

```bash
./scripts/install-agent-skills.sh --all
```

| Flag | Target |
|------|--------|
| `--cursor` | `.cursor/skills/` in this repo (`remogram-core`) |
| `--codex` | `~/.codex/skills/` (`remogram-consumer` + `remogram-core`) |
| `--claude ~/.claude/plugins/...` | copy Claude Code plugin adapter |
| `--consumer-only` | With `--codex`, install only `remogram-consumer` |
| `--all` | `--cursor` and `--codex` (default when no flags) |

**Cursor (this repo):** project skills under `.cursor/skills/` are synced from canonical sources.

**Codex:** skills under `~/.codex/skills/remogram-*`.

**Claude Code:** use `adapters/claude-code-plugin/` as a local plugin, or copy `skills/` into your plugin directory. Plugin manifest: `.claude-plugin/plugin.json`.

## Which skill to load

| Context | Skill |
|---------|--------|
| Any consumer repo with `.remogram.json` | `remogram-consumer` |
| Editing `packages/remogram-*`, providers, or tests in this repo | `remogram-core` |

Contributing to Remogram in this repo? Load **`remogram-core`**. Using Remogram in your own project? Load **`remogram-consumer`** (and install it globally with `--codex` if you use Codex).

## Adapters

| Agent | Path |
|-------|------|
| **All MCP hosts** | [`examples/mcp/README.md`](../../examples/mcp/README.md) — Cursor, Claude Desktop, Codex, Claude Code |
| Cursor | `adapters/cursor/` (rule + sync via install script); MCP: `.cursor/mcp.json.example` |
| Claude Code | `adapters/claude-code-plugin/`; MCP: `examples/mcp/claude-code.md` |
| Codex | `adapters/codex/README.md`; MCP: `examples/mcp/codex.*.config.toml.example` |

Do not edit adapter copies by hand — change canonical `skills/` and re-run the install script.
