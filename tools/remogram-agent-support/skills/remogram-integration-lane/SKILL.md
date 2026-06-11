---
name: remogram-integration-lane
description: Use when acting as Integration Lane in remogram dogfood — open integrate/* PRs that land command-owned sidecar, verification receipt, and lifecycle mutations on remo after implementation merge. Authority commitment rung only.
metadata:
  internal: true
---

# Remogram Integration Lane

Use after **`remogram-sdlc-core`** when implementation has merged to **`origin/remo`**
but integration-tip evidence is missing (`receipt_unlinked`, task in-progress,
bug closeout fields empty), or when all cluster tasks are **`done`** but
`goal_branch` is still **`active`** (goal cluster closeout).

Templates: `remogram-sdlc-core/references/lane-workflow-templates.md`
(Integration: Sidecar PR, Integration: Goal cluster closeout).

Cross-ref Topogram `decision_goal_cluster_closeout_integration_lane` and
`term_goal_cluster_closeout`.

## Required boundary output

Every lane stop must emit **both** the Standard Handoff Block and the **Standard Packet Envelope** JSON from `lane-workflow-templates.md`. Prose-only output is tier-2; Review may classify `missing_packet_envelope`.

## Role

Integration Lane owns the **authority commitment rung**. It opens PRs titled
`integrate:<slug>` with base **`remo`** containing command-owned sidecar mutations only.

Allowed:

- Verification run receipts on integration tip jsonl
- SDLC prep/history commits required for Closeout Gate
- Lifecycle sidecar mutations via command-owned workflow
- **`goal_branch` `active → done`** on goal cluster closeout integrate PR only

Forbidden:

- New product features (Develop Lane / impl PR)
- Planning-only topo on `goal/*` without impl context
- Declaring task done without Closeout Gate
- Declaring Intent Packet / goal cluster done before **all** cluster tasks are `done` on `remo`
- Transitioning `goal_branch` on per-wave integrate PRs (wave closeout closes tasks only)
- Merge without Review classification when required

## Wave closeout (per task)

After impl PR merges to `remo`:

```bash
git fetch origin
git checkout -B integrate/<slug>-closeout origin/remo
topogram sdlc verify run verification_<id> . --task <task-id> --write -- npm test
topogram sdlc transition <ac-id> approved . --actor <actor> --write --json
topogram work complete <task-id> . --verification verification_<id> --write --json
topogram sdlc prep commit . --json
topogram check . --json
```

PR title: `integrate:<slug>-closeout` → base **`remo`**.

## Goal cluster closeout (Intent Packet completion)

After **last** wave closeout merges and **all** plan-linked cluster tasks are `done`:

```bash
git fetch origin
git checkout -B integrate/<goal-id>-cluster-closeout origin/remo
# Preflight: no open impl/integrate PRs for this goal; all cluster tasks done
topogram sdlc transition goal_branch_<id> done . \
  --actor <actor> --evidence-ref <last-integrate-merge-sha> --write --json
topogram sdlc prep commit . --json
topogram check . --json   # must be ok before push
```

PR title: `integrate:<goal-id>-cluster-closeout` → base **`remo`**. Sidecar only.

## Preflight

```bash
git fetch origin
git checkout -B integrate/<slug> origin/remo
remogram pr view --number <impl-pr> --json   # confirm merged
topogram query goal-branch-queue ./topo --base origin/remo --json
```

Stop if implementation not merged or worktree dirty.

## After merge

Report handoff with `Artifact_rung: integration_pr`. Wave closeout → Proof Gate,
then Closeout Gate. Goal cluster closeout → Observer (`stop` when `topogram check` green).
