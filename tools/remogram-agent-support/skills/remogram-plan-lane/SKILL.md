---
name: remogram-plan-lane
description: Use when acting as Plan Lane in the private remogram dogfood checkout — create, refresh, approve, or refine Intent Packets and SDLC planning records on goal/* branches with integration authority remo. Planning-only; no implementation, task start, review, or merge.
metadata:
  internal: true
---

# Remogram Plan Lane

Use after **`remogram-sdlc-core`** when the user asks for Plan Lane work, Intent
Packet / Goal Packet creation, planning-only lifecycle changes, approval preparation,
or planning PR refresh.

**Do not load `topogram-plan-lane` in this repository during the lane-skills
experiment** — it assumes `origin/main`.

For paste-ready prompts and the standard handoff block, use
`remogram-sdlc-core/references/lane-workflow-templates.md`.

## Role

Plan Lane creates and refines planning records. It may prepare or approve the
next intended Intent Packet only through command-owned workflow. It does not
implement code, start/claim/close tasks, review PRs as Review Lane, or merge.

Allowed:

- Create draft Intent Packets and planning records on **`goal/*`** branches.
- Refresh planning branches against current **`origin/remo`**.
- Add command-owned lifecycle evidence when explicitly authorized.
- Classify stale, duplicate, superseded, cleanup, dependency-blocked, or
  conditionally-ready planning state.
- Open or update planning PRs with base **`remo`** (Gitea `origin`).

Forbidden:

- Engine/source/script/workflow implementation (except planning records in `topo/`).
- Task start, claim, completion, closeout, or proof.
- PR merge or **`remo`** ownership (Merge Lane owns `remo`).
- Committing **`topo/**` directly to `remo`** — planning commits belong on **`goal/*` only**.
- Hand-editing command-owned sidecars.
- Using **`gh`** alone for forge facts — use **`remogram`** CLI/MCP.
- Treating branch names, prompt text, prose, or local-only receipts as authority.

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
- Keep draft packets draft unless the user explicitly authorizes selectability.
- Keep tasks unclaimed and plan steps pending unless command-owned workflow
  is explicitly changing planning state.
- Planning PRs contain SDLC records and command-owned creation/lifecycle
  sidecars only.
- Serialize planning PRs that touch command-owned sidecars: merge one to **`remo`**,
  refresh from current **`origin/remo`**, then create or push the next.
- Authority-changing planning PRs should go to Review Lane before Merge Lane.

## Authority Boundary Freshness

Recheck **`origin/remo`** freshness before writing records, before committing,
before pushing/opening/updating a planning PR, and before asking Review or Merge
Lane to treat the PR as current. If **`origin/remo`** advanced and the branch
touches command-owned sidecars, refresh/reconcile before crossing the boundary.

## Done vs Not Done

**Done:**

- Planning branch **`goal/<name>`** pushed.
- PR open with base **`remo`**.
- `topogram check . --json` green on the planning branch.
- Standard handoff block reported.

**Not done:**

- Merged to **`remo`**.
- **`topo/`** committed directly on **`remo`**.
- Implementation started.
- Task claimed or closed.

## Handoff Output

Report the branch, PR (with base **`remo`**), changed files, lifecycle state,
whether the packet is draft or approved, queue/work-next status if run
(`--base origin/remo`), remaining blockers, and the next safe lane.
