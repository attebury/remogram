# Lane prompts (remogram dogfood / remo)

Paste the **repo preamble** first, then the lane block. Invoke skills with
`/remogram-plan-lane`, `/remogram-implement-lane`, etc. — not `/topogram-*`.

Run `./scripts/park-topogram-skills.sh park` before lane work so Cursor does not
surface generic Topogram skills from `~/.codex/skills/`.

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

Rules: planning-only; topo/** on goal/* only; topogram check before commit.
Done = PR to remo + check green — not merge, not commit to remo.
```

## Implement Lane — start task

```text
/remogram-implement-lane

[Paste repo preamble]
Load remogram-core for packages/**.

Preflight: origin/remo; fresh branch from remo; work start <task_id>; prep commit.

Task: Implement <task_id> only.

Done = PR base remo; topogram check green; handoff block.
```

## Review Lane — planning PR

```text
/remogram-reviewer

[Paste repo preamble]

Review Gitea PR <n> as planning PR (base remo).
remogram pr view/checks --number <n> --json

Return exactly one classification.
```

## Merge Lane

```text
/remogram-merge-lane

[Paste repo preamble]

Merge PR <n> to remo if review invariants hold.
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
