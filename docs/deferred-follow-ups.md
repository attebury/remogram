# Deferred follow-ups

Open forge issues for **functional product work** intentionally deferred after merge or review. Use this index when grooming the next cluster or re-arming Observer on related areas.

| Issue | Cluster / context | Status |
|-------|-------------------|--------|
| [#353](http://localhost:3000/attebury/remogram/issues/353) | `cr-inventory-probe-fallback-hardening` (post–PR #350 review) | open |

## #353 — `cr inventory` probe fallback follow-ups

**Context:** Post-merge code review of PR #350 (`cr-inventory-probe-fallback-hardening`, merged `origin/remo@acba0e8`). Cluster closed #348 (probe page reuse). Deferred for a later implement pass.

### Medium

1. **GitHub number-sort full collect uses offset `page=` instead of Link seed** — `paginateGitHubOpenPullList` `numberSortFullCollect` branch should continue Link pagination from the seeded probe response (`packages/provider-github-api/index.js`).
2. **Full collect inherits probe page size (`retain_max`, often 3)** — subsequent pages use probe `usedLimit` instead of provider `pageSize`; correct but extra round-trips on large repos (`packages/remogram-core/check-pagination.js`).
3. **`resolveListTruncatedWithTrustedTotal` ignores `fullCollect` param** — dead parameter at call sites; remove or wire intentional behavior (`packages/remogram-core/open-pull-list.js`).

### Low

- GitHub non–number-sort fallback stops after seeded page when Link header absent.
- Partial-page continue only on page 1 (`trustedEntryCount > walked` heuristic).
- Gitea tail failure: double retry before tail-only pagination adds latency.
- Unchanged deferrals: tail `limit=retainMax`, over-cap (>5000) behavior, GitLab `slice_sort_notes`.

### Suggested test gaps

- GitHub `number_asc` full collect with Link `rel=next` after probe seed (no duplicate page-1 fetch).
- Full collect page size after seed (or document retain_max-sized pages as intentional).
- `suppressFinalPageProbe` tail-only: `list_truncated` when tail page full but not repo end.

**References:** PR #350, closed #348, archive `archive/workcycle/cr-inventory-probe-fallback-hardening` (when present on tip).
