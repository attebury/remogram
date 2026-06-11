---
name: remogram-integration-lane
description: Use when acting as Integration Lane in remogram dogfood — open integrate/* PRs that land command-owned sidecar, verification receipt, and lifecycle mutations on remo after implementation merge. Authority commitment rung only.
metadata:
  internal: true
---

# Remogram Integration Lane

Use after **`remogram-sdlc-core`** when implementation has merged to **`origin/remo`**
but integration-tip evidence is missing (`receipt_unlinked`, task in-progress,
bug closeout fields empty).

Templates: `remogram-sdlc-core/references/lane-workflow-templates.md` (Integration: Sidecar PR).

## Required boundary output

Every lane stop must emit **both** the Standard Handoff Block and the **Standard Packet Envelope** JSON from `lane-workflow-templates.md`. Prose-only output is tier-2; Review may classify `missing_packet_envelope`.

## Role

Integration Lane owns the **authority commitment rung**. It opens PRs titled
`integrate:<slug>` with base **`remo`** containing command-owned sidecar mutations only.

Allowed:

- Verification run receipts on integration tip jsonl
- SDLC prep/history commits required for Closeout Gate
- Lifecycle sidecar mutations via command-owned workflow

Forbidden:

- New product features (Develop Lane / impl PR)
- Planning-only topo on `goal/*` without impl context
- Declaring task done without Closeout Gate
- Merge without Review classification when required

## Preflight

```bash
git fetch origin
git checkout -B integrate/<slug> origin/remo
remogram pr view --number <impl-pr> --json   # confirm merged
topogram query goal-branch-queue ./topo --base origin/remo --json
```

Stop if implementation not merged or worktree dirty.

## After merge

Report handoff with `Artifact_rung: integration_pr`. Next: Proof Gate, then Closeout Gate.
