# Progress: Plan Lane — forge trust round 2

## Approach
Plan Lane planning-only branch from `origin/dev/scaffold` (active implementation line; `origin/main` stale). SDLC records map second-pass security review (5 priority fixes) to phased plan. No implementation code.

## Steps So Far
1. Branch `plan/forge-trust-round2` from `origin/dev/scaffold`.
2. Created pitch, requirement, 5 bugs, 5 acceptance criteria, task, 7-step plan, draft goal_branch, verification.
3. Blocked `task_remogram_core` on `task_forge_trust_round2` until round 2 trust fixes land.

## Current Status
Planning records ready for planning PR → Review Lane → Merge Lane. Intent Packet **draft** (not approved/selectable).

## Current Failure / Open Item
`origin/main` (ce75135) is behind `dev/scaffold`; planning targets dev/scaffold line per repo convention.

## Five planned fixes
1. **C1** — baseUrl host must match remote; narrow trustedHosts to alias-only
2. **H1** — HTTP redirect policy (no credential relay)
3. **H2/H3** — git ref/remote argv hardening
4. **M1** — envelope trust fields immutable
5. **M3/M4** — sanitize errors, remote, URL schemes
