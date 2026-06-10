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
Next lane:
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

Report the standard handoff block.
```
