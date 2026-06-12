#!/usr/bin/env bash
# Shared CI gate for Remogram on local Gitea (Actions, optional pre-push).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BASE_REF="${DOGFOOD_GATE_BASE:-origin/main}"
HEAD_REF="${DOGFOOD_GATE_HEAD:-HEAD}"
LOG_FILE="${GITEA_GATE_LOG:-$HOME/gitea/log/remogram-gate.log}"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date -Iseconds)] $*"
}

stub_topogram_engine() {
  local topogram_engine="${TOPOGRAM_ENGINE_STUB:-$REPO_ROOT/../topogram/engine}"
  mkdir -p "$topogram_engine"
  if [[ ! -f "$topogram_engine/package.json" ]]; then
    printf '%s\n' '{"name":"@topogram/cli","version":"0.0.0","private":true}' >"$topogram_engine/package.json"
    log "stubbed Topogram engine at $topogram_engine/package.json"
  fi
}

IN_ACTIONS=0
if [[ -n "${CI:-}" || -n "${GITEA_ACTIONS:-}" ]]; then
  IN_ACTIONS=1
fi

run_gate() {
  log "remogram gitea gate start repo=$REPO_ROOT base=$BASE_REF head=$HEAD_REF"

  stub_topogram_engine
  npm ci
  npm test
  npm run test:coverage
  npm run security:secrets -- --base "$BASE_REF" --head "$HEAD_REF"

  log "remogram gitea gate pass"
}

if [[ "$IN_ACTIONS" == "1" ]]; then
  run_gate
else
  run_gate 2>&1 | tee -a "$LOG_FILE"
fi
