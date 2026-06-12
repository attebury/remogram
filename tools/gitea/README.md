# Remogram — local Gitea hybrid CI

Remogram dogfood on **local Gitea** uses the same hybrid pattern as Topogram:

| Trigger | Commit status | Script |
|---------|---------------|--------|
| `.gitea/workflows/ci-gate.yml` | Yes | `scripts/run-gitea-gate.sh` |
| Pre-push hook (optional) | No | same script |

## Host install (shared with Topogram)

Gitea + act_runner setup lives in the Topogram repo:

```bash
cd ~/Documents/topogram
./tools/gitea/scripts/install-hybrid-ci-local.sh
./tools/gitea/scripts/enable-repo-actions.sh attebury remogram
```

See [topogram/tools/gitea/HYBRID-CI.md](https://github.com/attebury/topogram/blob/main/tools/gitea/HYBRID-CI.md).

## Repo gate

```bash
./scripts/run-gitea-gate.sh
```

Runs: `npm ci`, `npm test`, `npm run test:coverage`, `npm run security:secrets`.

Environment (same convention as Topogram):

| Variable | Default |
|----------|---------|
| `DOGFOOD_GATE_BASE` | `origin/main` |
| `DOGFOOD_GATE_HEAD` | `HEAD` |
| `GITEA_GATE_LOG` | `~/gitea/log/remogram-gate.log` |

## Verify

```bash
remogram check status --ref HEAD --json
remogram merge plan --number <n> --json
```

Branch protection: require status check **CI gate**.

## GitHub CI

Publish CI remains on GitHub (`.github/workflows/`). Local Gitea uses `.gitea/workflows/ci-gate.yml` only.
