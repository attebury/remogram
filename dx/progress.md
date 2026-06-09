# Progress: Plan constraint — exclude dx/ from tests

## Approach
User constraint: do not test anything under `dx/`. Encoded in vitest config and test-strategy SDLC records on `plan/test-strategy-hardening`.

## Steps So Far
1. Added `test.exclude` and `coverage.exclude` for `dx/**` in `vitest.config.js`.
2. Updated pitch no_go_areas, task non_goals, plan R8 step, and README AC.
3. `npm test` still 34 passing.

## Current Status
Local edits on `plan/test-strategy-hardening`; not pushed. PR #6 may need refresh if merged before push.

## Current Failure / Open Item
None.

## Next safe lane
Push amend to PR #6 or new commit before Merge Lane.
