# Lane Workflow Templates (Remogram / remo)

Process rails for the private Gitea dogfood checkout. Integration authority is
**`remo`**, not `main`. CLI packets, SDLC records, gates, and user instructions
remain authoritative.

## Standard Handoff Block

```text
Lane:
Branch:
Base: origin/remo @ <sha>
Head: <sha>
PR: <number> (base remo)
Changed files:
Lifecycle changes:
Checks: (remogram + local proof if forge checks missing)
Queue/work-next: (--base origin/remo)
Next lane: (Review Lane or Plan Lane from Plan; Merge Lane only after Review classifies safe_for_merge_lane — never combined)
Stop condition:
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
```

## Implement: Start Selected Task

```text
You are Implement Lane (remogram dogfood).

Preflight:
- Fetch origin/remo.
- Create fresh implementation branch from current origin/remo.
- topogram query goal-branch-queue ./topo --base origin/remo --branches 'goal/*' --json
- Confirm goal lifecycle_state is approved (not draft).
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
- Planning-only scope; draft/approved lifecycle matches PR title (plan:draft vs plan:approve).
- plan:draft PR must not promote goal_branch, requirement, task, or verification status.
- plan:approve PR must show sdlc transition evidence for goal approval.
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
