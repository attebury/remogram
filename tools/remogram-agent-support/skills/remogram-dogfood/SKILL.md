---
name: remogram-dogfood
description: Use when working in the remogram repository with Topogram SDLC, lane workflow, PR review/merge, or integration on remo. Layers remogram-specific overrides on topogram-core and lane skills — does not replace them.
---

# Remogram Dogfood

This repository **models remogram in Topogram** (`topo/`) while shipping remogram product code. Load **`topogram-core`** first, then this skill, then the lane skill (`topogram-plan-lane`, `topogram-implement-lane`, `topogram-reviewer`, `topogram-verify-lane`, `topogram-merge-lane`).

Also load **`remogram-core`** when editing `packages/**` or provider behavior.

## Overrides for Topogram lane skills

These repo facts **supersede generic lane prose** that mentions `main` or platform-default integration branches:

| Topic | Remogram repo rule |
|-------|-------------------|
| Integration branch | **`remo`** only — Merge Lane owns `remo` |
| Topogram base ref | `--base origin/remo` for `sdlc gate`, `work prep`, `goal-branch-queue`, secret scan |
| Review/Merge forge facts | **`remogram`** CLI/MCP, not `gh` alone |
| Historical refs | Archive tags `archive/pre-remo-*`; lane branches `goal/*`, `plan/*` are archaeology |

Do **not** fork or disable Topogram lane skills globally. Apply these overrides only in this repository.

## First commands

```bash
topogram agent brief . --json
topogram work status . --json
topogram check . --json
topogram query goal-branch-queue ./topo --base origin/remo --branches 'goal/*' --json
remogram repo status --json
```

## Protected edits

Policy: `topogram.sdlc-policy.json`. Before `packages/**`, `topo/**`, `tests/**`, `scripts/**`, or root docs:

```bash
topogram work start task_remogram_core . --actor <actor> --write --json
topogram sdlc prep commit . --json
```

## Review and Merge Lane — forge + local proof

Dogfood remogram for PR facts:

```bash
remogram pr view --number <n> --json
remogram pr checks --number <n> --json
remogram merge plan --number <n> --json
```

**Local Gitea** often returns `check_conclusion: "missing"` because Actions/status posting is not configured. That is an expected forge fact, not a passed check.

When statuses are **missing**, require local proof from current refs:

```bash
topogram check . --json
npm test
```

When statuses are **present**, failed or pending forge checks remain blockers. Local proof does not override them.

## Merge Lane checklist (remo)

1. Fetch; confirm PR base is **`remo`**, head is the reviewed SHA.
2. Confirm mergeability via `remogram merge plan --json`.
3. Confirm checks per rule above.
4. Merge to **`remo`**; verify `origin/remo` tip.

## SDLC archaeology

Historical records may mention `dev/scaffold` or `main` as planning-time context. Do not rewrite archaeology in `topo/sdlc/goal_branches/`, pitches, or completed plans. Update **active** acceptance criteria and decisions only through Topogram commands.

Durable cutover law: `topo/sdlc/decisions/remogram_integration_authority_remo.tg`.

## Forge setup

- Daily remote: Gitea `origin` (`http://localhost:3000/attebury/remogram`)
- Default branch: **`remo`**
- Auth: `GITEA_TOKEN` for `gitea-api`
