#!/usr/bin/env bash
# Move ~/.codex/skills/topogram-* aside during remogram dogfood lane work.
# Cursor loads ~/.codex/skills/ for Codex compatibility — parking hides topogram-* from / menu.
set -euo pipefail

CODEX_SKILLS="${HOME}/.codex/skills"
PARKED="${HOME}/.codex/skills-parked"

usage() {
  cat <<'EOF'
Park or restore global Topogram skills under ~/.codex/skills/.

Usage: park-topogram-skills.sh <command>

Commands:
  park      Move topogram-* skill dirs to ~/.codex/skills-parked/
  unpark    Restore topogram-* from ~/.codex/skills-parked/ to ~/.codex/skills/
  status    Show active vs parked topogram skills

After park, install remogram lane skills globally:
  ./scripts/install-agent-skills.sh --cursor --codex --dogfood
EOF
}

list_active() {
  local found=0
  if [[ ! -d "$CODEX_SKILLS" ]]; then
    return 0
  fi
  for dir in "${CODEX_SKILLS}"/topogram*; do
    [[ -d "$dir" ]] || continue
    echo "active: $(basename "$dir")"
    found=1
  done
  return 0
}

list_parked() {
  local found=0
  if [[ ! -d "$PARKED" ]]; then
    return 0
  fi
  for dir in "${PARKED}"/topogram*; do
    [[ -d "$dir" ]] || continue
    echo "parked: $(basename "$dir")"
    found=1
  done
  return 0
}

cmd_park() {
  mkdir -p "$PARKED"
  local moved=0
  shopt -s nullglob
  for dir in "${CODEX_SKILLS}"/topogram*; do
    [[ -d "$dir" ]] || continue
    local name
    name="$(basename "$dir")"
    if [[ -d "${PARKED}/${name}" ]]; then
      echo "already parked: ${name}" >&2
      continue
    fi
    mv "$dir" "${PARKED}/${name}"
    echo "parked ${name}"
    moved=1
  done
  shopt -u nullglob
  if [[ "$moved" -eq 0 ]]; then
    echo "no topogram skills to park under ${CODEX_SKILLS}" >&2
  fi
}

cmd_unpark() {
  mkdir -p "$CODEX_SKILLS"
  local moved=0
  shopt -s nullglob
  for dir in "${PARKED}"/topogram*; do
    [[ -d "$dir" ]] || continue
    local name
    name="$(basename "$dir")"
    if [[ -d "${CODEX_SKILLS}/${name}" ]]; then
      echo "skip ${name}: already active under ${CODEX_SKILLS}" >&2
      continue
    fi
    mv "$dir" "${CODEX_SKILLS}/${name}"
    echo "unparked ${name}"
    moved=1
  done
  shopt -u nullglob
  if [[ "$moved" -eq 0 ]]; then
    echo "no topogram skills to unpark under ${PARKED}" >&2
  fi
}

cmd_status() {
  echo "Codex skills: ${CODEX_SKILLS}"
  echo "Parked dir:   ${PARKED}"
  echo "---"
  list_active
  list_parked
}

main() {
  if [[ $# -ne 1 ]]; then
    usage >&2
    exit 1
  fi
  case "$1" in
    park) cmd_park ;;
    unpark) cmd_unpark ;;
    status) cmd_status ;;
    -h|--help) usage ;;
    *) echo "unknown command: $1" >&2; usage >&2; exit 1 ;;
  esac
}

main "$@"
