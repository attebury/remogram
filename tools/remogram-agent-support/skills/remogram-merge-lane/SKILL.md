---
name: remogram-merge-lane
description: Use when acting as Merge Lane in remogram dogfood — own integration branch remo, validate reviewed PRs, merge to remo on Gitea, post-merge queue from origin/remo without implementing work.
metadata:
  internal: true
---

# Remogram Merge Lane

<!-- forked_from: topogram-merge-lane @ 2026-06-10 -->

Use after **`remogram-sdlc-core`** and **`remogram-dogfood`** when Merge Lane
merges a reviewed PR to **`remo`**.

**Do not load `topogram-merge-lane` during the lane-skills experiment.**

Templates: `remogram-sdlc-core/references/lane-workflow-templates.md`.

## Required boundary output

Every lane stop must emit **both** the Standard Handoff Block and the **Standard Packet Envelope** JSON from `lane-workflow-templates.md`. Prose-only output is tier-2; Review may classify `missing_packet_envelope`.

## Role

Merge Lane owns integration on **`remo`**. It may merge reviewed PRs, update
**`remo`**, run post-merge validation, and report handoff evidence. It does not
implement code, approve/select goals, start/claim/close tasks, or edit planning
records outside the merge.

Allowed:

- Fetch remote refs and update local **`remo`** when this worktree owns it.
- Confirm PR head, base **`remo`**, mergeability, checks, scope, review invariants.
- Merge safe PRs through the project-approved merge method (Gitea).
- Pull/update local **`remo`** to match **`origin/remo`**.
- Run read-only post-merge queue/work-next/status with **`--base origin/remo`**.
- Report handoff for Plan, Implement, Review, or Verify Lane.

Forbidden:

- Bypassing failed or pending required checks (when forge reports them present).
- Merging a changed head without renewed review.
- Implementing fixes, mutating planning state, or starting follow-up work.
- Treating branch names, stale checks, or local refs as merge authority.

## Freshness Preflight

Before merging:

1. Fetch current refs.
2. Confirm Merge Lane or approved merge path.
3. Confirm worktree is clean.
4. Confirm PR open, not draft, base **`remo`**, mergeable, at reviewed head.
5. Forge facts:

```bash
remogram pr view --number <n> --json
remogram pr checks --number <n> --json
remogram merge plan --number <n> --json
```

6. Apply Gitea missing-check rule from **`remogram-dogfood`**: if checks
   missing, require `topogram check . --json` + `npm test` on reviewed refs.
7. Confirm changed files and scope match reviewed lane purpose.

Recheck invariants immediately before merge. If head, base, checks, or scope
changed, return to Review or Plan Lane.

## Post-Merge

Merge Lane is not done until post-merge handoff from **`origin/remo`**:

1. Confirm **`origin/remo`** tip matches merge result.
2. Confirm worktree clean.
3. Run read-only queue/status:

```bash
topogram query goal-branch-queue ./topo --base origin/remo --branches 'goal/*' --json
topogram work status . --json
```

4. Do not start implementation or mutate lifecycle state.

Do not stop after reporting only the merge commit — include queue/work-next
from current **`origin/remo`** in the standard handoff block.

Report PR URL, merge commit, **`origin/remo`** SHA, checks performed,
queue/work-next result, and next safe lane.
