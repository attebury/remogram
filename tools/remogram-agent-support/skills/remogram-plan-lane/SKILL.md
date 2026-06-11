---
name: remogram-plan-lane
description: Use when acting as Plan Lane in the private remogram dogfood checkout — create, refresh, approve, or claim-wave Intent Packets and SDLC planning records on goal/* branches with integration authority remo. Planning-only; no implementation, task start, review, or merge.
metadata:
  internal: true
---

# Remogram Plan Lane

Use after **`remogram-sdlc-core`** when the user asks for Plan Lane work, Intent
Packet / Goal Packet creation, planning-only lifecycle changes, goal approval,
wave claim (`plan:claim-wave`), or planning PR refresh.

**Do not load `topogram-plan-lane` in this repository during the lane-skills
experiment** — it assumes `origin/main`.

For paste-ready prompts and the standard handoff block, use
`remogram-sdlc-core/references/lane-workflow-templates.md` and
`remogram-dogfood/references/lane-prompts.md`.

## Required boundary output

Every lane stop must emit **both** the Standard Handoff Block and the **Standard Packet Envelope** JSON from `lane-workflow-templates.md`. Prose-only output is tier-2; Review may classify `missing_packet_envelope`.

## Role

Plan Lane creates and refines planning records. It may prepare, approve, or
claim waves on the next intended Intent Packet only through command-owned workflow. It does not
implement code, start/claim/close tasks, review PRs as Review Lane, or merge.

Allowed:

- Create draft Intent Packets and planning records on **`goal/*`** branches.
- Refresh planning branches against current **`origin/remo`**.
- Add command-owned lifecycle evidence when explicitly authorized.
- Classify stale, duplicate, superseded, cleanup, dependency-blocked, or
  conditionally-ready planning state.
- Open or update planning PRs with base **`remo`** (Gitea `origin`).

## Issue promotion preflight

Before creating a **new** `goal/*` branch:

1. Search `topo/sdlc` for related records (future: `topogram query sdlc-search`).
2. **Explore-only** → open a Gitea issue (intent rung); no `topo/` commit required.
3. **Durable design** → refresh an existing goal cluster or open `plan:draft` on `goal/<name>`.
4. Chat and agent prose are **not** backlog authority (`decision_issue_before_planning_pr` on Topogram).

Forbidden:

- Engine/source/script/workflow implementation (except planning records in `topo/`).
- Task start, claim, completion, closeout, or proof.
- PR merge or **`remo`** ownership (Merge Lane owns `remo`).
- Committing **`topo/**` directly to `remo`** — planning commits belong on **`goal/*` only**.
- Hand-editing `status` on `goal_branch`, `requirement`, `task`, `verification`,
  `decision`, or `plan` records — use `topogram sdlc transition` only.
- Promoting req/tasks/verifications/decisions in a **draft** PR.
- Hand-editing command-owned sidecars.
- Using **`gh`** alone for forge facts — use **`remogram`** CLI/MCP.
- Treating branch names, prompt text, prose, or local-only receipts as authority.

## Three planning PR types

| Type | PR title prefix | Authority granted | Lifecycle changes |
|------|-----------------|-------------------|-------------------|
| **Draft packet** | `plan:draft` | none (proposal only) | Create/refresh records; goal stays **`draft`** |
| **Approve packet** | `plan:approve` | pursue this Intent Packet | **`goal_branch` `draft` → `ready` → `approved`** via CLI |
| **Claim wave** | `plan:claim-wave` | implement this wave’s task | Named wave task’s **`acceptance_refs` → `approved`** via CLI |

User must name the exact record for **approve** (`goal_branch_<id>`) or **claim-wave**
(`task_<wave>` plus each `ac_<id>` to approve).

Draft PRs must not approve goals, claim waves, or promote requirements, tasks,
verifications, or acceptance criteria unless the user explicitly authorizes the
matching PR type.

**Approve ≠ claim-wave ≠ implement.** Goal approval does not clear
`goal-branch-queue` for implementation; claim-wave does not start or claim tasks
(Implement Lane owns `work start`).

## Command-owned goal approval

Goal branch lifecycle: **`draft` → `ready` → `approved` → `active` → `done` → `archived`**.

When the user authorizes approval of a named goal branch:

```bash
# Read-only preview first
topogram sdlc transition <goal-branch-id> ready . \
  --actor <actor> --evidence-ref <ref> --json

topogram sdlc transition <goal-branch-id> approved . \
  --actor <actor> --evidence-ref <ref> --write --json
```

Run `topogram sdlc prep commit . --json` before committing transition sidecars.
Use the same pattern for other SDLC `status` fields (`requirement`, `task`,
`acceptance_criterion`, etc.) — never hand-edit `.tg` status lines.

## Command-owned claim wave

When the user authorizes a named wave task (e.g. `task_forge_trust_round4_wave1`):

1. Confirm `goal_branch` is already **`approved`** on current **`origin/remo`**.
2. List that task’s `acceptance_refs` from the task record.
3. Transition each acceptance criterion **`draft` → `approved`**:

```bash
topogram sdlc transition <ac-id> approved . \
  --actor <actor> --write --json
```

4. Run `topogram sdlc prep commit . --json` before commit.
5. Verify queue readiness:

```bash
topogram query goal-branch-queue ./topo --base origin/remo --branches 'goal/*' --json
```

Done for claim-wave when the named task’s wave is **selectable** or **ready** on
the queue (or blockers are reported explicitly in the handoff). Do not transition
task status to claimed — that is Implement Lane.

## Freshness Preflight

Before creating or updating Intent Packet records:

1. Fetch current **`origin/remo`**.
2. Create or refresh the planning branch **`goal/<name>`** from current **`origin/remo`**.
3. Confirm the worktree is clean.
4. Confirm the base includes the latest merged planning PR to **`remo`**.
5. Stop before writing records if the base is stale.

Plan Lane does not need to checkout local **`remo`**; Merge Lane owns **`remo`**
when lane worktrees are active.

## Commit Gate

Before any commit that touches **`topo/**`**:

1. Confirm current branch matches **`goal/*`** — not **`remo`**.
2. Run `topogram check . --json` — must report `ok` before commit, push, or PR.

## Planning PR Rules

- PR base is always **`remo`** on Gitea `origin`.
- **Draft PR:** keep `goal_branch.status` **`draft`**; keep tasks unclaimed; keep ACs draft.
- **Approve PR:** goal transitions only via `topogram sdlc transition`; PR title **`plan:approve …`**.
- **Claim-wave PR:** AC transitions only for the named wave task; PR title **`plan:claim-wave …`**; tasks stay **unclaimed**.
- Planning PRs contain SDLC records and command-owned creation/lifecycle sidecars only.
- Serialize planning PRs that touch command-owned sidecars: merge one to **`remo`**,
  refresh from current **`origin/remo`**, then create or push the next.
- After opening a planning PR, hand off to **Review Lane** — not Merge Lane directly.

## Authority Boundary Freshness

Recheck **`origin/remo`** freshness before writing records, before committing,
before pushing/opening/updating a planning PR, and before asking Review Lane
to treat the PR as current. If **`origin/remo`** advanced and the branch touches
command-owned sidecars, refresh/reconcile before crossing the boundary.

## Done vs Not Done

**Draft PR done:**

- Planning branch **`goal/<name>`** pushed.
- PR open with base **`remo`**; title **`plan:draft …`**.
- `goal_branch.status` still **`draft`**.
- `topogram check . --json` green.
- Handoff **Next lane: Review Lane**.

**Approve PR done:**

- Transitions recorded via `sdlc transition`; `goal_branch.status` is **`approved`**.
- PR open with base **`remo`**; title **`plan:approve …`**.
- `topogram check . --json` green.
- Handoff **Next lane: Review Lane** (then **`plan:claim-wave`** if queue still blocked).

**Claim-wave PR done:**

- Named wave task’s acceptance criteria **`approved`** via `sdlc transition` receipts.
- Task still **unclaimed**; goal still **approved**.
- PR open with base **`remo`**; title **`plan:claim-wave …`**.
- `goal-branch-queue` shows wave **selectable** or **ready** (or handoff lists remaining blockers).
- `topogram check . --json` green.
- Handoff **Next lane: Review Lane** (Implement only after merge + queue green).

**Not done (all PR types):**

- Merged to **`remo`** (Merge Lane owns that).
- **`topo/`** committed directly on **`remo`**.
- Implementation started.
- Task claimed or closed.
- Handoff naming **Merge Lane** or **Implement Lane** as the next agent action from Plan Lane.

Merge Lane is a **separate human prompt** after Review classifies `safe_for_merge_lane`.

## Handoff Output

Report the branch, PR (with base **`remo`**), changed files, lifecycle state,
whether the packet is draft, approved, or wave-claimed-ready, queue/work-next status if run
(`--base origin/remo`), remaining blockers, and:

- **Next lane:** **`Review Lane`** or **`Plan Lane`** only — never **`Merge Lane`**.
