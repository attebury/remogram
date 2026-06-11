---
name: remogram-observer
description: Use as read-only Branch Workcycle router in remogram dogfood — compose observer_snapshot via proto script, synthesize observer_report with single next_actor, optional readonly lane_delegation. Never mutate merge or approve.
metadata:
  internal: true
---

# Remogram Observer

Use after **`remogram-sdlc-core`** when routing between lanes without mutating
workflow state. Observer answers **what next**; Retro promotes friction to issues.

Templates: `remogram-sdlc-core/references/lane-workflow-templates.md` (Observer section).

**Do not load generic `topogram-*-lane` skills for Observer routing.**

## Role

Observer is **read-only**. It inventories open artifacts by commitment rung and
emits exactly one `next_actor` (or `stop` when ambiguous). It never approves,
merges, starts/claims/closes tasks, or edits planning records.

Allowed:

- Run proto `observer-snapshot.sh` and interpret CLI packets
- Emit `observer_report` and optional advisory `lane_delegation`
- Suggest paste-ready handoff prompt for the target lane

Forbidden:

- Satisfying queue, merge, lifecycle, or proof gates
- Mutating `topo/**`, `packages/**`, or command-owned sidecars
- Overriding authoritative CLI packets when `ok: true`

## Preflight

From remogram repo root:

```bash
git fetch origin
OBSERVER_BASE=origin/remo /path/to/topogram/tools/branch-workcycle/observer-snapshot.sh . --json
```

Dogfood layout: topogram checkout is typically a sibling directory
(`../topogram/tools/branch-workcycle/observer-snapshot.sh`). Document the path
you used in the handoff block.

## Synthesize

1. Parse `observer_snapshot.packets` (agent brief, work status, goal-branch-queue, sdlc gate, remogram repo status).
2. Build commitment-rung inventory: open `goal/*`, draft vs approved goals, blocked queue items, dirty worktree, unlinked receipts, **goal_branch `active` with all cluster tasks `done`**.
3. Emit **`observer_report`** v1 with singular `next_actor`.

### next_actor enum

`plan_lane` | `implement_lane` | `review_lane` | `verify_lane` | `merge_lane` |
`integration_lane` | `retro_lane` | `open_issue` | `stop`

Actors-only per Topogram `decision_lane_canon`: `review_gate` is renamed
**`review_lane`**, **`verify_lane`** is added, and the former `proof_gate` /
`closeout_gate` are **edge predicates evaluated during a routing tick**, not
routing destinations. Each routing tick reads trusted-envelope packet fields
only and emits exactly one actor or a fail-closed `stop`.

Fail closed to **`stop`** when two lanes are equally valid or required preflight is missing.

### Routing graph (edges)

Per Topogram `decision_lane_routing_graph`, the Branch Workcycle is a **total graph**
(every node has an outgoing edge; `stop` is reachable from every node):

```
open_issue -> plan_lane -> implement_lane -> review_lane
review_lane -> merge_lane            (review safe)
review_lane -> implement_lane        (needs changes)
review_lane -> plan_lane             (stale / superseded)
merge_lane  -> verify_lane -> integration_lane
integration_lane -> integration_lane (proof guard: wave closeout)
integration_lane -> stop             (closeout guard true)
stop -> retro_lane                   (friction found / TTL tick)
retro_lane -> open_issue
<any non-terminal> -> stop           (operational failure -> typed blocker; see Wave 4)
```

`release_lane` is a deferred terminal boundary (out of scope for v1). Advisory
per-node tiers (`default_subagent_type` / `model_policy`): plan_lane=plan_high_thinking,
implement_lane=implement_medium, review_lane=review_balanced, verify_lane/merge_lane=gate_fast,
integration_lane=implement_medium, observer ticks=gate_fast (synthesis=plan_high_thinking).

**Goal cluster closeout routing:** when impl merged and receipt unlinked → `integration_lane`
(wave closeout). When all cluster tasks are `done` on `origin/remo`, `goal_branch.status`
is still `active`, and `topogram check` reports goal lifecycle advisory →
`integration_lane` with handoff template **Goal cluster closeout**. When cluster
closeout merged and `topogram check` is green → `stop`.

Cross-ref Topogram `decision_goal_cluster_closeout_integration_lane`.

## Delegation (optional)

Parent may delegate readonly exploration before routing:

- `explore` subagent — high thinking, readonly
- `shell` subagent — fast, readonly commands only

Emit advisory `lane_delegation` per Topogram `decision_default_lane_packet_envelope`.
Parent Observer retains routing authority; subagent output is tier-3 evidence only.

## Required boundary output

Every Observer stop must emit:

1. Standard Handoff Block (`Role_kind: advisory`, `Artifact_rung: chat`)
2. **`observer_report`** JSON (see template)
3. Paste-ready **Handoff Prompt** for `next_actor` lane

Prose-only output is tier-2; Review may classify `missing_packet_envelope` on prior lane stops.

## Triggers

- After **Merge Lane** handoff ("what's next?")
- Before opening a new `goal/*` branch
- User invokes `/remogram-observer`
- Stale draft TTL review (advisory)

## Cross-refs

- Topogram `decision_observer_routing_advisory`
- Topogram `plan_forge_branch_workcycle_observer`
- Remogram `decision_remogram_observer_routing_advisory` (if present on goal branch)
