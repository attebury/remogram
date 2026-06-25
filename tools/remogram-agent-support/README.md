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
| `--all` | `--cursor` and `--codex` (default when no flags) |


## Which skill to load

| Context | Skill |
|---------|--------|
| Any consumer repo with `.remogram.json` | `remogram-consumer` |
| `packages/**` in this repo | `remogram-core` |

## Adapters

| Agent | Path |
|-------|------|
| Cursor | `adapters/cursor/`; MCP: `.cursor/mcp.json.example` |
| Codex | `adapters/codex/README.md` |
| Claude Code | `adapters/claude-code-plugin/` |

Do not edit adapter copies by hand — change canonical `skills/` and re-run the install script.

### Maintainer sync workflow (private `remo`)

Dogfood commits **two** skill trees: canonical `tools/remogram-agent-support/skills/` and the Cursor mirror `.cursor/skills/`.

1. Edit the **tools** copy only.
2. Sync the mirror:

```bash
./scripts/install-agent-skills.sh --cursor --dogfood
```

3. Commit both trees together.
4. `npm test -- tests/agent-skills-parity.test.mjs` must pass (directory parity, including `references/`).

When updating autonomous Observer `auto_merge.allowed_paths`, prefer **per-skill** globs from:

```bash
node scripts/dogfood-merge-allowed-paths.mjs --json
```

Merge `static_globs` and `skill_globs` into `lane-registry.local.json`. Avoid broad `.cursor/skills/**`.
