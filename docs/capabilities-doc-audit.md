# Capabilities documentation audit

Audit date: 2026-06-15. Goal: align public-facing docs with **0.1.0-beta.4** product surface (15 read/plan commands, opt-in writes via `write_commands`). Follow-up to [#475](http://localhost:3000/attebury/remogram/issues/475) write policy remediation.

## Authoritative registries (code)

| Registry | Source |
|----------|--------|
| Read/plan commands (15) | `packages/remogram-core/contracts/semantic-diff-facts.js` → `V1_READ_PLAN_COMMANDS` |
| Write command ids (2) | `packages/remogram-core/write-config.js` → `WRITE_COMMAND_IDS` (`cr_open`, `status_set`) |
| MCP tools (19) | `examples/mcp/README.md` — same JSON as CLI |

## Prior audits

| Audit | Scope | Gap closed here |
|-------|--------|-----------------|
| [#475 write policy](CHANGELOG.md) | README, AGENTS, skills, MCP README, doctor hints | `llms.txt`, claude-code MCP list, skill write rails, README beta banner |
| [Topogram public audit](public-topogram-audit.md) | Provenance allowlist | No change — provenance lines kept |

## Inventory (verdict → action)

| File | Tier | Verdict | Action |
|------|------|---------|--------|
| `llms.txt` | public-export | rewrite | beta.4 scope, `write_commands`, both write ids, expanded first commands |
| `README.md` L28 | public-export | rewrite | Beta limitations aligned with write policy |
| `README.md` L82 | public-export | rewrite | “six” → 15 read/plan commands |
| `README.md` L135–152 | public-export | expand | Full command bash block |
| `examples/mcp/claude-code.md` | examples | rewrite | 19 MCP tools + write policy |
| `remogram-consumer/SKILL.md` | public-skill-npx | rewrite | `cr open` example; fix L264/L286 flat denies |
| `remogram-core/SKILL.md` | public-skill-npx | rewrite | `cr open` in CLI block; semantic-diff shipped (not post-beta) |
| `CHANGELOG.md` Unreleased | public-export | append | Doc audit entry |
| `tests/docs/doc-consistency.test.mjs` | tests | add | Regression guardrails |

## Write rails checklist (#475 gap)

> Both commands, no contradictions, synced installs.

- **Both commands:** symmetric `cr open` + `status set` CLI examples in canonical skills; both ids in `llms.txt`
- **No contradictions:** consumer L264/L286; core semantic-diff section; README beta banner
- **Synced installs:** `./scripts/install-agent-skills.sh --cursor --codex` post-merge (operator step)

## Verification

```bash
npm test -- tests/docs/ tests/export/
bash scripts/export-public-main.sh /tmp/remogram-public-doc-audit
rg -i topogram /tmp/remogram-public-doc-audit/README.md /tmp/remogram-public-doc-audit/llms.txt
# Expect provenance lines only; CHANGELOG historical lines OK
```

Regression: `tests/docs/doc-consistency.test.mjs` imports `WRITE_COMMAND_IDS` from `@remogram/core` and asserts doc prose matches.
