---
name: remogram-implement-lane
description: Use when acting as Implement Lane in the private remogram dogfood checkout — start selected tasks from origin/remo, fresh implementation branches, scoped work, proof, and PRs to remo without merging.
metadata:
  internal: true
---

# Remogram Implement Lane

<!-- forked_from: topogram-implement-lane @ 2026-06-10 -->

Use after **`remogram-sdlc-core`** and, for code changes, with **`remogram-core`**
when editing `packages/**`.

**Do not load `topogram-implement-lane` during the lane-skills experiment.**

Templates: `remogram-sdlc-core/references/lane-workflow-templates.md`.

## Role

Implement Lane starts and implements selected work. It does not create planning
authority, approve/select goals, review as Review Lane, or merge PRs.

Allowed:

- Create a fresh implementation branch or per-task worktree from current
  **`origin/remo`**.
- Run canonical queue/work-next with **`--base origin/remo`**.
- Start exactly the selected task through command-owned workflow.
- Edit only packet-authorized maintained targets.
- Run focused proof and gates.
- Push an implementation branch and open a PR with base **`remo`**.

Forbidden:

- Implementing on a **`goal/*`** planning branch or stale planning PR branch.
- Taking local **`remo`** from Merge Lane.
- Starting a task that current **`origin/remo`** does not select or mark ready.
- Approving/selecting goals, merging PRs, or hand-editing SDLC sidecars.
- Expanding scope beyond the selected task and packet.

## Freshness Preflight

Before starting work:

1. Fetch current **`origin/remo`**.
2. Create the implementation branch from current **`origin/remo`**.
3. Run `topogram work next . --json` or queue with **`--base origin/remo`**.
4. Confirm the intended task is selected or code-edit-ready.
5. Run read-only `work start` and inspect blockers.
6. Run `work start --write` only after the preview is clean.

Protected edits require:

```bash
topogram work start <task-id> . --actor <actor> --write --json
topogram sdlc prep commit . --json
```

If a merged **`goal/*`** ref reports `base_not_ancestor`, treat that ref as
historical evidence and select from current **`origin/remo`** instead.

## Proof And PR

Recheck **`origin/remo`** freshness before `work start --write`, before editing,
before closeout/prep/gate, and before pushing or opening the implementation PR.

Run `topogram check . --json` before commit/push/PR — must be `ok`.

Run proof commands named by the packet plus required Topogram gates. Use
`work closeout`, `work prep`, and `work gate` before PR handoff when applicable.

Open a PR with base **`remo`**. Do not merge. Report branch, PR URL (base remo),
changed files, proof run, closeout state, blockers, and next lane.
