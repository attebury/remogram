# Lane prompts (remogram dogfood / remo)

Paste the **repo preamble** first, then the lane block. Invoke skills with
`/remogram-plan-lane`, `/remogram-implement-lane`, etc. — not `/topogram-*`.

**Review and Merge are two prompts.** Never combine "review/merge" under
`/remogram-reviewer`. Review classifies only; Merge is `/remogram-merge-lane`
in a **separate message** with reviewed head SHA.

Run `./scripts/park-topogram-skills.sh park` before lane work so Cursor does not
surface generic Topogram skills from `~/.codex/skills/`.

**Three Plan Lane paths (separate PRs):** `plan:draft` (proposal) → `plan:approve`
(goal authorized) → `plan:claim-wave` (wave ACs approved, queue ready). Goal
approval does not authorize Implement — claim-wave does.

## Repo preamble

```text
Repository: remogram (private dogfood on Gitea origin).

Integration authority:
- Integration branch is remo — not main.
- main is public GitHub export only — not Gitea integration authority.
- Merge Lane owns remo. Plan uses goal/*; Implement uses task branches.

Topogram base ref: --base origin/remo for gate, prep, goal-branch-queue.

Forge facts: remogram CLI/MCP — not gh alone.
Gitea check_conclusion "missing" is a forge fact; if missing, require topogram check + npm test.

Protected paths: topogram work start <task> . --actor <actor> --write --json
                 topogram sdlc prep commit . --json

Law: topo/sdlc/decisions/remogram_integration_authority_remo.tg
```

## Plan Lane — draft Intent Packet

```text
/remogram-plan-lane

[Paste repo preamble]

You are Plan Lane.

Preflight: fetch origin/remo; goal/<name> from origin/remo; clean worktree;
latest planning PR merged to remo; stop if stale.

Task: <goal description>

Rules: planning-only; topo/** on goal/* only; keep goal_branch.status draft;
do not promote req/tasks/verifications; topogram check before commit.
PR title: plan:draft <slug>

Done = PR to remo + check green — not merge, not commit to remo.
Handoff Next lane: Review Lane only.
```

## Plan Lane — approve Intent Packet (Round 4)

```text
/remogram-plan-lane

[Paste repo preamble]

You are Plan Lane.

Branch: goal/forge-trust-round4 from origin/remo.

Task: Approve Intent Packet goal_branch_forge_trust_round4 only.

Preflight:
- git fetch origin
- Checkout goal/forge-trust-round4 from origin/remo
- Confirm goal_branch_forge_trust_round4.status is draft
- topogram check . --json before commit

Lifecycle (command-owned only — no hand-edited status fields):
1. topogram sdlc transition goal_branch_forge_trust_round4 ready . \
     --actor <actor> --evidence-ref local:human-approve-round4 --json
2. topogram sdlc transition goal_branch_forge_trust_round4 approved . \
     --actor <actor> --evidence-ref local:human-approve-round4 --write --json
3. topogram sdlc prep commit . --json before commit

Optional (if authorized): accept proposed decisions via sdlc transition on
decision_forge_ingest_cap_policy and decision_packet_trust_doctrine.

Forbidden:
- Hand-edit goal_branch/requirement/task/verification/decision status in .tg files
- Implement code; work start; merge PR
- Commit topo/ to remo

PR title: plan:approve forge-trust-round4

Done = PR open to remo + goal_branch.status approved + topogram check green.
Done ≠ merge to remo. Done ≠ Implement (queue may still need plan:claim-wave).

Handoff Next lane: Review Lane only.
```

## Plan Lane — claim wave (Round 4, wave 1)

```text
/remogram-plan-lane

[Paste repo preamble]

You are Plan Lane.

Branch: goal/forge-trust-round4 from origin/remo.

Task: Claim wave task_forge_trust_round4_wave1 only.

Preflight:
- git fetch origin
- Checkout goal/forge-trust-round4 from origin/remo
- Confirm goal_branch_forge_trust_round4.status is approved on origin/remo
- Confirm task_forge_trust_round4_wave1.status is unclaimed
- topogram check . --json before commit

Lifecycle (command-owned only — approve this wave's acceptance_refs):
1. topogram sdlc transition ac_packet_trust_doctrine approved . \
     --actor <actor> --write --json
2. topogram sdlc transition ac_doctor_fail_closed approved . \
     --actor <actor> --write --json
3. topogram sdlc transition ac_sanitize_url_no_credentials approved . \
     --actor <actor> --write --json
4. topogram sdlc transition ac_public_scripts_no_remo_default approved . \
     --actor <actor> --write --json
5. topogram sdlc prep commit . --json before commit

Verify:
topogram query goal-branch-queue ./topo --base origin/remo --branches 'goal/forge-trust-round4' --json
(Wave 1 should be selectable or ready after merge — report blockers if not.)

Forbidden:
- Hand-edit status fields in .tg files
- Transition task to claimed; work start; implement; merge PR
- Commit topo/ to remo

PR title: plan:claim-wave forge-trust-round4 wave1

Done = PR open to remo + Wave 1 ACs approved + topogram check green.
Done ≠ task claimed. Done ≠ merge to remo. Done ≠ Implement until queue green on remo.

Handoff Next lane: Review Lane only.
```

## Implement Lane — start task

```text
/remogram-implement-lane

[Paste repo preamble]
Load remogram-core for packages/**.

Preflight: origin/remo; fresh branch from remo; goal-branch-queue shows goal
approved AND named task selectable/ready (plan:claim-wave done if was blocked);
work start <task_id>; prep commit.

Task: Implement <task_id> only.

Done = PR base remo; topogram check green; handoff block.
```

## Review Lane — planning or implementation PR

```text
/remogram-reviewer

[Paste repo preamble]

Review Gitea PR <n> (base remo). Classification only — do not merge.

remogram pr view/checks --number <n> --json (or Gitea API if config invalid)

Return exactly one classification and reviewed head SHA.
If safe_for_merge_lane: tell human to run /remogram-merge-lane in a separate message.
```

## Merge Lane

```text
/remogram-merge-lane

[Paste repo preamble]

Merge PR <n> to remo. Reviewed head <sha> from Review Lane classification above.

Post-merge: queue from origin/remo in handoff block.
```

## Maintainer startup

```bash
./scripts/park-topogram-skills.sh park
./scripts/install-agent-skills.sh --cursor --codex --dogfood
```

Restore Topogram skills when done with dogfood:

```bash
./scripts/park-topogram-skills.sh unpark
```
