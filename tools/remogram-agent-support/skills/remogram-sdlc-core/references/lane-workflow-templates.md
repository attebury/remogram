# Lane Workflow Templates (Remogram / remo)

Process rails for the private Gitea dogfood checkout. Integration authority is
**`remo`**, not `main`. CLI packets, SDLC records, gates, and user instructions
remain authoritative.

## Standard Handoff Block

```text
Lane:
Role_kind:         lane | gate | advisory
Artifact_rung:     chat | issue | planning_pr | impl_pr | integration_pr | release
Branch:
Base: origin/remo @ <sha>
Head: <sha>
PR: <number> (base remo) | none
Changed files:
Lifecycle changes:
Checks: (remogram + local proof if forge checks missing)
Queue/work-next: (--base origin/remo)
Evidence_class: authoritative | unlinked | stale | advisory
Stop condition:
Next lane: (Review Lane or Plan Lane from Plan; Merge Lane only after Review classifies safe_for_merge_lane — never combined)
Classification: (Review Lane only)
```

## Standard Packet Envelope (required at every boundary)

Emit **both** the semi-structured handoff block above **and** this Topogram-shaped JSON block. Gates and queue consume CLI JSON; handoff prose alone is tier-2 only. Cross-ref Topogram `decision_default_lane_packet_envelope` and issue #15.

```json
{
  "type": "lane_handoff_packet",
  "version": 1,
  "ok": true,
  "authority_boundary": {
    "handoff_output": "advisory_only",
    "cli_packets_required_for_gates": true
  },
  "subject": {
    "lane_role": "lane_plan",
    "artifact_rung": "planning_pr",
    "integration_ref": "origin/remo @ <sha>"
  },
  "next_commands": ["topogram check . --json"]
}
```

When delegating to a subagent, parent lane may also emit `lane_delegation` (advisory; parent retains mutations). Review Lane classifies `missing_packet_envelope` if this JSON block is absent.

## Issue Promotion Preflight (Plan Lane)

```text
Before opening a new goal/* branch:
- Search topo/sdlc for related records (future: topogram query sdlc-search).
- If explore-only: open forge issue (intent rung) — no topo commit yet.
- If durable design warranted: refresh winning goal cluster or open plan:draft on goal/<name>.
- Chat is never backlog authority.
```

## Plan: Draft Intent Packet

```text
You are Plan Lane (remogram dogfood).

Preflight:
- Fetch origin/remo.
- Create or refresh goal/<name> from current origin/remo.
- Confirm worktree is clean.
- Confirm base includes latest merged planning PR to remo.
- Stop before writing if origin/remo is stale.

Task:
Create a draft Intent Packet for <goal>.

Rules:
- Planning-only. No packages/** implementation.
- Do not approve/select/start/close work unless explicitly requested.
- Keep goal_branch.status draft; tasks unclaimed; plan steps pending.
- topo/** commits only on goal/<name> — never on remo.
- Command-owned SDLC workflow; no hand-edited sidecars.
- topogram check . --json before commit/push/PR.

After creation:
- Open or update PR: head goal/<name> → base remo.
- Recheck origin/remo before push.
- Report the standard handoff block.
```

## Plan: Refresh Planning PR

```text
You are Plan Lane (remogram dogfood).

Preflight:
- Fetch origin/remo.
- Checkout goal/<name>; merge or rebase onto origin/remo.
- Stop if worktree dirty or base stale.

Task:
Refresh planning records on goal/<name> for PR <n> (base remo).

Forbidden:
- Commit topo/ to remo.
- Implement code or merge the PR.

Gates:
- topogram check . --json before commit.
- Push goal/<name>; confirm PR base is remo.

Report the standard handoff block. Next lane: Review Lane only.
```

## Plan: Approve Intent Packet

```text
You are Plan Lane (remogram dogfood).

Preflight:
- Fetch origin/remo.
- Checkout goal/<name> from current origin/remo.
- Confirm goal_branch_<id>.status is draft.
- Confirm user named exact goal_branch_<id> for approval.
- Stop if worktree dirty or base stale.

Task:
Approve <goal_branch_id> via command-owned transitions only.

Lifecycle:
- topogram sdlc transition <goal_branch_id> ready . --actor <actor> --evidence-ref <ref> --json
- topogram sdlc transition <goal_branch_id> approved . --actor <actor> --evidence-ref <ref> --write --json
- topogram sdlc prep commit . --json before commit

Rules:
- PR title plan:approve <slug>.
- No hand-edited status fields in .tg files.
- No implement; no work start; no merge.
- topo/** on goal/<name> only.
- topogram check . --json before commit/push/PR.

After approval:
- Open or update PR: head goal/<name> → base remo.
- Report handoff block. Next lane: Review Lane only (not Merge Lane).
- If queue still blocked on acceptance criteria: handoff notes plan:claim-wave next — not Implement.
```

## Plan: Claim Wave

```text
You are Plan Lane (remogram dogfood).

Preflight:
- Fetch origin/remo.
- Checkout goal/<name> from current origin/remo.
- Confirm goal_branch_<id> is already approved on origin/remo.
- Confirm user named exact task_<wave> and wave acceptance_refs to approve.
- Stop if worktree dirty or base stale.

Task:
Claim wave <task_id> — approve its acceptance criteria only.

Lifecycle (per acceptance_refs on the task record):
- topogram sdlc transition <ac-id> approved . --actor <actor> --write --json
- topogram sdlc prep commit . --json before commit

Verify:
- topogram query goal-branch-queue ./topo --base origin/remo --branches 'goal/*' --json
- Named task selectable or ready (or report remaining blockers).

Rules:
- PR title plan:claim-wave <slug> <wave>.
- No hand-edited status fields in .tg files.
- Do not transition task to claimed; no work start; no implement; no merge.
- topo/** on goal/<name> only.
- topogram check . --json before commit/push/PR.

After claim-wave:
- Open or update PR: head goal/<name> → base remo.
- Report handoff block. Next lane: Review Lane only.
- Implement Lane only after merge and queue shows wave ready.
```

## Implement: Start Selected Task

```text
You are Implement Lane (remogram dogfood).

Preflight:
- Fetch origin/remo.
- Create fresh implementation branch from current origin/remo.
- topogram query goal-branch-queue ./topo --base origin/remo --branches 'goal/*' --json
- Confirm goal lifecycle_state is approved (not draft).
- Confirm <task_id> wave is queue selectable/ready (not blocked on acceptance_not_approved).
- If blocked: stop — Plan Lane plan:claim-wave required first.
- topogram work next . --json.
- Confirm <task_id> is selected or code-edit-ready.
- topogram work start <task_id> . --actor <actor> --write --json
- topogram sdlc prep commit . --json before protected edits.

Task:
Implement <task_id> only.

Rules:
- Do not implement on goal/* or remo.
- Do not approve/select/merge.
- topogram check . --json before commit/push/PR.
- PR base remo.

Report the standard handoff block.
```

## Implement: Fix Review Finding

```text
You are Implement Lane (remogram dogfood).

Preflight:
- Fetch origin/remo.
- Confirm PR head/base and review finding still apply.
- Worktree clean.

Task:
Fix only Review Lane finding(s) for PR <number> (base remo).

Rules:
- No scope expansion.
- Re-run focused proof and topogram check . --json.
- Push updated head; do not merge.

Report changed files, proof, new head SHA, next lane.
```

## Review: Planning PR

```text
You are Review Lane (remogram dogfood).

Preflight:
- git fetch origin
- Review by remote head/base SHAs; do not checkout remo.
- remogram pr view --number <n> --json
- remogram pr checks --number <n> --json

Task:
Review PR <n> as planning PR (expect base remo).

Check:
- Planning-only scope; lifecycle matches PR title (plan:draft | plan:approve | plan:claim-wave).
- plan:draft PR must not promote goal_branch, requirement, task, AC, or verification status.
- plan:approve PR must show sdlc transition evidence for goal approval only.
- plan:claim-wave PR must show AC sdlc transition receipts; task stays unclaimed.
- No task start/claim/done unless in scope.
- Command-owned sidecars coherent; no hand-edited status fields.
- Reconfirm head/base/mergeability before safe_for_merge_lane.

Return exactly one classification. Do not merge.
Report reviewed head SHA. If safe_for_merge_lane, tell human to use /remogram-merge-lane separately.
```

## Review: Implementation PR

```text
You are Review Lane (remogram dogfood).

Preflight:
- git fetch origin
- Review by remote head/base SHAs.
- remogram pr view/checks/merge plan --number <n> --json

Task:
Review PR <n> against <task_id> (base remo).

Check:
- Scope matches task and Intent Packet.
- Proof covers changed surfaces.
- Public output sanitized.
- Forge checks: if missing on Gitea, note local proof requirement.

Return exactly one classification. Do not merge.
Report reviewed head SHA. If safe_for_merge_lane, tell human to use /remogram-merge-lane separately.
```

## Merge: Reviewed PR

```text
You are Merge Lane (remogram dogfood).

Preflight:
- git fetch origin
- PR <n> open, not draft, base remo, head = reviewed SHA
- remogram merge plan --number <n> --json
- remogram pr checks --number <n> --json
- If checks missing: topogram check . --json + npm test on reviewed refs
- Worktree clean; scope matches review

Task:
Merge PR <n> to remo if all invariants hold.

After merge:
- Confirm origin/remo tip
- topogram query goal-branch-queue ./topo --base origin/remo --branches 'goal/*' --json
- Do not start follow-up work

Done = handoff block includes queue/work-next from origin/remo.
```

## Verify: Target-Bound Proof

```text
You are Verify Lane (remogram dogfood).

Preflight:
- git fetch origin
- Identify exact base, head, target surface, allowed command route
- Stop if binding or proof route missing

Task:
Verify <verification_id> for <task_id> on reviewed refs.

Rules:
- No lifecycle/merge mutations.
- No scope expansion beyond target.
- Bind evidence to task, command, base/head, policy hash.

Report proof status, receipt class, blockers, next lane.
```

## Integration: Sidecar PR

```text
You are Integration Lane (remogram dogfood).

Preflight:
- git fetch origin
- Confirm implementation PR merged to origin/remo
- Confirm verification receipt unlinked or lifecycle closeout missing on integration tip
- Create integrate/<slug> from current origin/remo

Task:
Land command-owned sidecar only: verification runs jsonl, SDLC prep/history, lifecycle mutations required to satisfy the closeout guard.

Rules:
- PR title integrate:<slug> — authority/integration commitment rung
- PR base remo; no packages/** product features unless bugfix for sidecar tooling
- topogram sdlc prep commit . --json before commit
- topogram check . --json before push/PR
- Forbidden: declare task done from this PR without closeout-guard evidence

After push:
- Report handoff with Artifact_rung: integration_pr
- Next: evaluate the proof guard then the closeout guard (edge predicates per decision_lane_canon), then route to stop — not Release
```

## Integration: Goal cluster closeout

```text
You are Integration Lane (remogram dogfood).

Preflight:
- git fetch origin
- Confirm all plan-linked cluster tasks are done on origin/remo
- Confirm final wave integrate PR merged; no open impl/integrate PRs for this goal
- Confirm goal_branch_<id>.status is still active
- topogram check . --json — expect goal lifecycle advisory until transition
- Create integrate/<goal-id>-cluster-closeout from current origin/remo

Task:
Land command-owned sidecar only: sdlc transition goal_branch_<id> done,
SDLC prep/history, no product code.

Rules:
- PR title integrate:<goal-id>-cluster-closeout — authority/integration commitment rung
- PR base remo; sidecar and lifecycle mutations only
- topogram sdlc transition goal_branch_<id> done . --actor <actor> --evidence-ref <sha> --write --json
- topogram sdlc prep commit . --json before commit
- topogram check . --json must be ok before push/PR
- Forbidden: goal_branch done before all cluster tasks done; goal_branch transition on wave closeout PR

After push:
- Report handoff with Artifact_rung: integration_pr
- Next lane: Observer (expect stop when topogram check green)
```

## Observer: Branch Workcycle snapshot

Run proto snapshot (topogram checkout):

```bash
OBSERVER_BASE=origin/remo ../topogram/tools/branch-workcycle/observer-snapshot.sh . | jq .
```

Then synthesize **`observer_report`** from `observer_snapshot.packets`. Exactly one `next_actor` or `stop`.

Example `observer_report`:

```json
{
  "type": "observer_report",
  "version": 1,
  "ok": true,
  "authority_boundary": {
    "handoff_output": "advisory_only",
    "cli_packets_required_for_gates": true
  },
  "subject": {
    "lane_role": "observer",
    "artifact_rung": "chat",
    "integration_ref": "origin/remo @ <sha>"
  },
  "inventory": {
    "open_goal_branches": ["goal/remo-forge-ladder-enforcement"],
    "draft_goals": 1,
    "queue_blockers": []
  },
  "blockers": [],
  "wip": { "dirty_worktree": false },
  "next_actor": "review_lane",
  "next_commands": [
    "topogram query goal-branch-queue ./topo --base origin/remo --branches 'goal/*' --json"
  ],
  "handoff_prompt_id": "review_planning_pr"
}
```

**Runbook** (actors-only enum per Topogram `decision_lane_canon`: `plan_lane`,
`implement_lane`, `review_lane`, `verify_lane`, `merge_lane`, `integration_lane`,
`retro_lane`, `open_issue`, `stop`)

1. Merge Lane done → run snapshot with `OBSERVER_BASE=origin/remo`
2. If queue shows approved goal + selectable task → `next_actor: implement_lane`
3. If open planning PR needs review → `next_actor: review_lane`
4. If reviewed PR needs target-bound proof → `next_actor: verify_lane`
5. If impl merged but receipt unlinked → `next_actor: integration_lane` (wave closeout)
6. If all cluster tasks done and goal_branch still active with check red → `next_actor: integration_lane` (goal cluster closeout)
7. If ambiguous → `next_actor: stop` and list blockers

## Retro: Advisory Report

```text
You are Retro Lane (remogram dogfood).

Task:
Review lane handoffs and CLI packets for friction. Emit advisory retro_report only.

Rules:
- Every finding promotes to a new forge issue (intent rung) — not chat backlog
- Same evidence vocabulary: receipt_unlinked, stale_goal_ref, wrong_commitment_rung
- Never block protected gates; never merge or mutate lifecycle
```
