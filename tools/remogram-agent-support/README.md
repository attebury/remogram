# Remogram agent support

Agent-agnostic skill pack for Remogram CLI and MCP. Canonical source:

```
tools/remogram-agent-support/skills/
├── remogram-consumer/       # any repo with .remogram.json
├── remogram-core/           # Remogram product development
├── remogram-dogfood/        # private Gitea maintainer (internal)
├── remogram-sdlc-core/      # SDLC + remo workcycle (internal, experiment)
├── remogram-plan-lane/      # Plan Lane (internal, experiment)
├── remogram-implement-lane/ # Implement Lane (internal, experiment)
├── remogram-reviewer/       # Review Lane (internal, experiment)
├── remogram-verify-lane/    # Verify Lane (internal, experiment)
├── remogram-merge-lane/     # Merge Lane (internal, experiment)
├── remogram-integration-lane/ # Integration Lane (internal, experiment)
└── remogram-observer/       # Read-only Branch Workcycle router (internal)
```

**Public:** only `remogram-consumer` and `remogram-core` (via GitHub / `npx skills`).

**Private Gitea `remo`:** internal skills are maintainer-only — stripped by `scripts/export-public-main.sh` (driven by `scripts/dogfood-skills.list`).

## Lane-skills experiment

Generic `topogram-*-lane` skills assume `origin/main`. This repo integrates on **`remo`**. Maintainers use **remogram-native** lane skills instead.

### Why `/top` shows Topogram skills in Cursor

[Cursor loads `~/.codex/skills/`](https://cursor.com/docs/skills) for Codex compatibility. Topogram skills installed there appear in the Agent `/` menu even when project `.cursor/skills/` only has remogram skills.

**Park Topogram skills before dogfood lane work:**

```bash
./scripts/park-topogram-skills.sh park
./scripts/install-agent-skills.sh --cursor --codex --dogfood
```

| Command | Purpose |
|---------|---------|
| `park-topogram-skills.sh park` | Move `~/.codex/skills/topogram-*` → `~/.codex/skills-parked/` |
| `park-topogram-skills.sh unpark` | Restore Topogram skills to `~/.codex/skills/` |
| `park-topogram-skills.sh status` | Show active vs parked |

Restore when done: `./scripts/park-topogram-skills.sh unpark`

### Skill load order

| Order | Skill |
|-------|--------|
| 1 | `remogram-sdlc-core` |
| 2 | Lane skill (`remogram-plan-lane`, `remogram-implement-lane`, `remogram-reviewer`, `remogram-verify-lane`, `remogram-merge-lane`, `remogram-integration-lane`) |
| 3 | `remogram-dogfood` (Gitea forge + merge proof) |
| + | `remogram-observer` after `remogram-sdlc-core` for routing only — no lane mutations after |
| + | `remogram-core` when editing `packages/**` |

Do **not** load `topogram-core` or `topogram-*-lane` in this repo while the experiment runs.

Paste prompts: `skills/remogram-dogfood/references/lane-prompts.md`.

## Install

### Option A — `npx skills` (npm / GitHub)

[vercel-labs/skills](https://github.com/vercel-labs/skills) clones from **GitHub** — not `@remogram/*` on npm. Internal skills are **not** on public GitHub.

```bash
npx skills add attebury/remogram --skill remogram-consumer -g -a cursor,codex -y
npx skills add attebury/remogram --skill remogram-core -a cursor -y
```

### Option B — install script (clone)

```bash
./scripts/install-agent-skills.sh --all
```

| Flag | Target |
|------|--------|
| `--cursor` | `.cursor/skills/` (`remogram-core`) |
| `--codex` | `~/.codex/skills/` (`remogram-consumer` + `remogram-core`) |
| `--dogfood` | Internal skills from `scripts/dogfood-skills.list` → `.cursor/skills/` and `~/.codex/skills/` when `--codex` |
| `--all` | `--cursor` and `--codex` (default when no flags) |

**Maintainer dogfood startup:**

```bash
./scripts/park-topogram-skills.sh park
./scripts/install-agent-skills.sh --cursor --codex --dogfood
```

## Which skill to load

| Context | Skill |
|---------|--------|
| Any consumer repo with `.remogram.json` | `remogram-consumer` |
| `packages/**` in this repo | `remogram-core` |
| `topo/**` or lane work on Gitea `remo` | `remogram-sdlc-core` → lane skill + `remogram-dogfood` |

## Adapters

| Agent | Path |
|-------|------|
| Cursor | `adapters/cursor/`; MCP: `.cursor/mcp.json.example` |
| Codex | `adapters/codex/README.md` |
| Claude Code | `adapters/claude-code-plugin/` |

Do not edit adapter copies by hand — change canonical `skills/` and re-run the install script.
