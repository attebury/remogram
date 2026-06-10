# Remogram agent support

Agent-agnostic skill pack for Remogram CLI and MCP. Canonical source:

```
tools/remogram-agent-support/skills/
├── remogram-consumer/   # any repo with .remogram.json
└── remogram-core/       # Remogram product development (packages, providers, tests)
```

(`remogram-dogfood/` exists on private maintainer checkouts only — not on public GitHub.)

## Install

Two supported paths. Use either or both depending on your setup.

### Option A — `npx skills` (npm / GitHub)

[vercel-labs/skills](https://github.com/vercel-labs/skills) discovers skills under `tools/remogram-agent-support/skills/` from repo root or GitHub — no reshuffle required.

```bash
# Consumer — install once globally
npx skills add attebury/remogram --skill remogram-consumer -g -a cursor,codex -y

# Contributor — project scope in Remogram repo
npx skills add attebury/remogram --skill remogram-core -a cursor -y

# Inspect without installing
npx skills add attebury/remogram --list

# Explicit subpath
npx skills add attebury/remogram/tree/main/tools/remogram-agent-support --skill remogram-consumer -g -y
```

| Scope | Typical paths (`npx skills` v1.5+) |
|-------|-------------------------------------|
| Project | `.agents/skills/<name>/` (Cursor, Codex, and many others) |
| Global Cursor | `~/.cursor/skills/<name>/` |
| Global Codex | `~/.codex/skills/<name>/` |

`npx skills` installs **SKILL.md trees only**. It does not copy Cursor rules (`.cursor/rules/remogram.mdc`) or the Claude Code plugin under `adapters/claude-code-plugin/`. Use Option B for those.

Update installed skills: `npx skills update remogram-consumer remogram-core -y`

### Option B — install script (clone)

From the Remogram repository root:

```bash
./scripts/install-agent-skills.sh --all
```

| Flag | Target |
|------|--------|
| `--cursor` | `.cursor/skills/` in this repo (`remogram-core`) |
| `--codex` | `~/.codex/skills/` (`remogram-consumer` + `remogram-core`) |
| `--claude PATH` | copy Claude Code plugin adapter |
| `--consumer-only` | With `--codex`, install only `remogram-consumer` |
| `--dogfood` | Also install `remogram-dogfood` (shown only when that skill directory exists) |
| `--all` | `--cursor` and `--codex` (default when no flags) |

**Cursor (this repo):** project skills under `.cursor/skills/` are synced from canonical sources for teammates who rely on committed copies.

**Codex:** skills under `~/.codex/skills/remogram-*`.

**Claude Code:** use `adapters/claude-code-plugin/` as a local plugin, or `--claude ~/.claude/plugins/...`. Plugin manifest: `.claude-plugin/plugin.json`.

## Which skill to load

| Context | Skill |
|---------|--------|
| Any consumer repo with `.remogram.json` | `remogram-consumer` |
| Editing `packages/remogram-*`, providers, or tests in this repo | `remogram-core` |

Contributing to Remogram in this repo? Load **`remogram-core`**. Using Remogram in your own project? Load **`remogram-consumer`** (install globally with `npx skills -g` or `./scripts/install-agent-skills.sh --codex --consumer-only`).

## Adapters

| Agent | Path |
|-------|------|
| **All MCP hosts** | [`examples/mcp/README.md`](../../examples/mcp/README.md) — Cursor, Claude Desktop, Codex, Claude Code |
| Cursor | `adapters/cursor/` (rule + sync via install script); MCP: `.cursor/mcp.json.example` |
| Claude Code | `adapters/claude-code-plugin/`; MCP: `examples/mcp/claude-code.md` |
| Codex | `adapters/codex/README.md`; MCP: `examples/mcp/codex.*.config.toml.example` |

Do not edit adapter copies by hand — change canonical `skills/` and re-run the install script or `npx skills update`.
