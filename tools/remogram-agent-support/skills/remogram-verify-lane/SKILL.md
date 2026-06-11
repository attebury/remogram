---
name: remogram-verify-lane
description: Use when acting as Verify Lane in remogram dogfood — target-bound proof, verification receipts, and evidence validation on origin/remo refs without implementing, approving scope, or merging.
metadata:
  internal: true
---

# Remogram Verify Lane

<!-- forked_from: topogram-verify-lane @ 2026-06-10 -->

Use after **`remogram-sdlc-core`** for Verify Lane proof, receipt inspection,
or evidence validation.

**Do not load `topogram-verify-lane` during the lane-skills experiment.**

Templates: `remogram-sdlc-core/references/lane-workflow-templates.md`.

## Required boundary output

Every lane stop must emit **both** the Standard Handoff Block and the **Standard Packet Envelope** JSON from `lane-workflow-templates.md`. Prose-only output is tier-2; Review may classify `missing_packet_envelope`.

## Role

Verify Lane proves or classifies evidence for a specific target. It does not
approve scope, select goals, start/claim/close tasks, implement fixes, or merge.

Allowed:

- Fetch refs and identify exact base/head/target commits.
- Run authorized verification commands.
- Write verification receipts only when explicitly permitted.
- Classify evidence as authoritative, advisory, stale, wrong-target,
  wrong-command, unlinked, tampered, forged, expired, or unsupported.
- Report proof gaps and next safe commands.

Forbidden:

- Treating prose, branch names, or lane labels as proof authority.
- Mutating lifecycle, approval, selection, task start, or merge state.
- Broadening proof scope beyond the target.
- Recording raw secrets, local absolute paths, or unbounded logs in public packets.

## Freshness Preflight

Before verification:

1. Fetch current refs; integration tip is **`origin/remo`** unless reviewing a
   specific PR head/base pair.
2. Identify exact base, head, target commit, target surface, policy hash,
   Topogram source hash, and allowed command route.
3. Confirm the target is still current.
4. Stop if target binding, command authority, or proof route is missing.

Queue/status checks use **`--base origin/remo`**:

```bash
topogram work status . --json
topogram query goal-branch-queue ./topo --base origin/remo --branches 'goal/*' --json
```

## Evidence Output

Recheck target freshness before classifying proof as current. Stale base/head or
policy hash invalidates prior verification for protected gates.

Report proof status, receipt authority class, target binding, blockers,
commands run, artifacts written, and the next safe lane.
