---
name: remogram-reviewer
description: Use when reviewing Gitea PRs in remogram dogfood as Review Lane — planning or implementation scope against Intent Packets on integration branch remo, merge readiness via remogram CLI, safe_for_merge_lane classification.
metadata:
  internal: true
---

# Remogram Reviewer

<!-- forked_from: topogram-reviewer @ 2026-06-10 -->

Use after **`remogram-sdlc-core`** when acting as Review Lane or reviewing a PR
for Merge Lane on Gitea **`remo`**.

**Do not load `topogram-reviewer` during the lane-skills experiment.**

Templates: `remogram-sdlc-core/references/lane-workflow-templates.md`.

## Review Lane Role

Review Lane is read-mostly. It reviews PRs for scope, architecture, tests,
trust boundaries, packet alignment, and merge readiness. It does not implement
code, merge PRs, approve/select goals, start/claim/close tasks, or mutate SDLC
lifecycle state.

Do not take local **`remo`**; Merge Lane owns **`remo`**. Fetch remote refs;
review by remote head/base SHAs.

## Review Start

Before reviewing:

```bash
git fetch origin
git status --short --branch
remogram pr view --number <n> --json
remogram pr checks --number <n> --json
remogram merge plan --number <n> --json
```

Record reviewed head and base SHAs. Expect PR base **`remo`** on Gitea `origin`.

For Topogram behavior in this repo:

```bash
topogram check . --json
topogram security status . --json
```

## Gitea forge checks

Local Gitea often returns `check_conclusion: "missing"`. That is an expected
forge fact, not a passed check.

When statuses are **missing**, require local proof on reviewed refs:

```bash
topogram check . --json
npm test
```

When statuses are **present**, failed or pending forge checks remain blockers.
Local proof does not override them.

## Review Checklist

- Planning PRs: SDLC records and command-owned sidecars only; draft goals;
  unclaimed tasks; pending plan steps.
- Implementation PRs: match selected task/Intent Packet; inside scope/non-goals.
- PRs touching command-owned sidecars: current and mergeable against latest
  **`origin/remo`**; green checks alone are not enough.
- No hand-edited lifecycle/status/history/proof sidecars.
- Public output portable and sanitized.

For authority-changing planning PRs, hand off to Merge Lane with:

- Reviewed PR head, base **`remo`**, goal branch ref unchanged.
- Pre-merge invariants: checks per rule above, mergeable, head/scope unchanged.
- Post-merge: Merge Lane updates **`origin/remo`**, runs queue with
  **`--base origin/remo`**, does not start implementation.

Before `safe_for_merge_lane`, reconfirm head, base, checks, mergeability, scope.

## Output

Findings first, by severity. End with exactly one recommendation:

- `safe_for_merge_lane`
- `needs_implement_lane_changes`
- `needs_plan_lane_classification`
- `needs_refresh_or_reconcile`
- `stale_or_superseded`
- `blocked`
