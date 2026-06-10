---
name: remogram-dogfood
description: Use when working in the private remogram Gitea checkout with Topogram SDLC and lane workflow on integration branch remo. Load after remogram-sdlc-core; adds forge setup and Gitea-specific review/merge proof rules.
metadata:
  internal: true
---

# Remogram Dogfood

Private maintainer checkout: Topogram models remogram in `topo/` while shipping
product code in `packages/**`.

## Skill load order (lane-skills experiment)

1. **`remogram-sdlc-core`** — trust, protected paths, branch workcycle (`remo`, `goal/*`)
2. **`remogram-plan-lane`** — when acting as Plan Lane (more lane skills added later)
3. **`remogram-core`** — when editing `packages/**` or providers

**Do not load** `topogram-core` or generic `topogram-*-lane` skills during the
experiment — they assume `origin/main`.

Install: `./scripts/install-agent-skills.sh --cursor --dogfood`

## First commands

```bash
topogram agent brief . --json
topogram work status . --json
topogram check . --json
topogram query goal-branch-queue ./topo --base origin/remo --branches 'goal/*' --json
remogram repo status --json
```

## Protected edits

Policy: `topogram.sdlc-policy.json`. Before protected paths:

```bash
topogram work start <task-id> . --actor <actor> --write --json
topogram sdlc prep commit . --json
```

## Review and Merge — forge + local proof

```bash
remogram pr view --number <n> --json
remogram pr checks --number <n> --json
remogram merge plan --number <n> --json
```

**Local Gitea** often returns `check_conclusion: "missing"` because Actions/status
posting is not configured. That is an expected forge fact, not a passed check.

When statuses are **missing**, require local proof from current refs:

```bash
topogram check . --json
npm test
```

When statuses are **present**, failed or pending forge checks remain blockers.

## Merge Lane checklist

1. Fetch; confirm PR base is **`remo`**, head is the reviewed SHA.
2. Confirm mergeability via `remogram merge plan --json`.
3. Confirm checks per rule above.
4. Merge to **`remo`**; verify `origin/remo` tip.

## Forge setup

- Remote: Gitea `origin` (`http://localhost:3000/attebury/remogram`)
- Integration branch: **`remo`**
- Auth: `GITEA_TOKEN` for `gitea-api`

Law: `topo/sdlc/decisions/remogram_integration_authority_remo.tg`
