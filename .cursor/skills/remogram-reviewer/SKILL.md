---
name: remogram-reviewer
description: Use when reviewing Gitea PRs in remogram dogfood as Review Lane — planning or implementation scope against Intent Packets on integration branch remo, merge readiness via remogram CLI, safe_for_merge_lane classification. Review Lane never merges PRs.
metadata:
  internal: true
---

# Remogram Reviewer

<!-- forked_from: topogram-reviewer @ 2026-06-10 -->

Use after **`remogram-sdlc-core`** when acting as Review Lane or reviewing a PR
for Merge Lane on Gitea **`remo`**.

**Do not load `topogram-reviewer` during the lane-skills experiment.**

Templates: `remogram-sdlc-core/references/lane-workflow-templates.md`.

## Required boundary output

Review Lane must emit the **Standard Packet Envelope** JSON when stopping, in addition to the classification footer. Classify `missing_packet_envelope` when the reviewed lane's prior handoff lacked required JSON.

## Review Lane Role

Review Lane is read-mostly. It reviews PRs for scope, architecture, tests,
trust boundaries, packet alignment, and merge readiness. It does not implement
code, merge PRs, approve/select goals, start/claim/close tasks, or mutate SDLC
lifecycle state.

Do not take local **`remo`**; Merge Lane owns **`remo`**. Fetch remote refs;
review by remote head/base SHAs.

## Does not merge

Review Lane **stops after one classification**.

**Never merge** — even if:

- The user prompt says "review/merge" or "review and merge".
- Only **`remogram-reviewer`** is attached (not **`remogram-merge-lane`**).
- Classification is **`safe_for_merge_lane`**.

Merge is always a **separate message** with **`/remogram-merge-lane`**, PR number,
and reviewed head SHA. Review Lane does not merge — even as a follow-up in the
same chat after `safe_for_merge_lane`.

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

If `remogram` CLI fails (e.g. config), use Gitea API + local proof per
**`remogram-dogfood`**.

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

- Planning PRs: SDLC records and command-owned sidecars only.
- **`plan:draft` PR:** `goal_branch` stays **`draft`**; tasks unclaimed; plan steps pending.
- **`plan:approve` PR:** `goal_branch` promoted via `sdlc transition` evidence, not hand-edits.
- **`plan:claim-wave` PR:** named wave task’s acceptance criteria promoted via `sdlc transition`; task stays unclaimed.
- Implementation PRs: match selected task/Intent Packet; inside scope/non-goals.
- PRs touching command-owned sidecars: current and mergeable against latest
  **`origin/remo`**; green checks alone are not enough.
- No hand-edited lifecycle/status/history/proof sidecars.
- Public output portable and sanitized.

## Lifecycle coherence (planning PRs)

| Condition | Typical classification |
|-----------|------------------------|
| `plan:draft` PR but `goal_branch` or req promoted | `needs_plan_lane_classification` |
| Hand-edited `status` without transition receipt | `needs_plan_lane_classification` |
| `goal_branch` draft + `requirement` approved + `verification` active | `needs_plan_lane_classification` (note in findings) |
| `plan:approve` PR without `sdlc transition` evidence for goal | `needs_plan_lane_classification` |
| `plan:claim-wave` PR but task claimed or ACs still draft | `needs_plan_lane_classification` |
| `plan:claim-wave` PR without AC `sdlc transition` receipts for named wave | `needs_plan_lane_classification` |
| `plan:approve` PR that also approves ACs (mixed approve + claim) | `needs_plan_lane_classification` (split PRs) |
| Impl PR with only topo/** on goal branch | `wrong_commitment_rung` (planning PR expected) |
| Impl merged but receipt unlinked on origin/remo | `needs_integration_pr` |
| Forge issue body used as impl scope without plan:approve | `issue_should_not_impl` |
| Integration PR with product feature scope | `wrong_commitment_rung` (impl PR expected) |
| Lane handoff without `lane_handoff_packet` JSON envelope | `missing_packet_envelope` |

Before `safe_for_merge_lane`, reconfirm head, base, checks, mergeability, scope.
When a PR needs target-bound proof (not just classification), route to
**`verify_lane`** for a verification receipt before Merge Lane, per Topogram
`decision_lane_canon`.

## Output

Findings first, by severity. End with exactly one recommendation:

- `safe_for_merge_lane`
- `needs_implement_lane_changes`
- `needs_plan_lane_classification`
- `needs_refresh_or_reconcile`
- `wrong_commitment_rung`
- `needs_integration_pr`
- `issue_should_not_impl`
- `missing_packet_envelope`
- `stale_or_superseded`
- `blocked`

Then report reviewed head SHA and this footer (always):

```text
Reviewed head <sha>. Review Lane never merges PRs.
If safe_for_merge_lane: new message → /remogram-merge-lane Merge PR <n>. Reviewed head <sha>.
```

Do not merge PRs from Review Lane. Do not name Merge Lane as an action Review
Lane will perform in this message.
