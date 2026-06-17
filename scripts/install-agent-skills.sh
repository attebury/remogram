#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANONICAL="${ROOT}/tools/remogram-agent-support/skills"
CURSOR_DEST="${ROOT}/.cursor/skills"
CODEX_DEST="${HOME}/.codex/skills"
DOGFOOD_LIST="${ROOT}/scripts/dogfood-skills.list"
CLAUDE_DEST=""
DO_CURSOR=0
DO_CODEX=0
DO_CLAUDE=0
DO_DOGFOOD=0
CONSUMER_ONLY=0

DOGFOOD_SKILLS=()
if [[ -f "$DOGFOOD_LIST" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="$(echo "$line" | xargs)"
    [[ -n "$line" ]] && DOGFOOD_SKILLS+=("$line")
  done < "$DOGFOOD_LIST"
fi

usage() {
  cat <<'EOF'
Install remogram agent skills from canonical tools/remogram-agent-support/skills/.

Usage: install-agent-skills.sh [options]

Options:
  --cursor          Sync remogram-core to .cursor/skills/
  --codex           Copy remogram-consumer (+ core) to ~/.codex/skills/
  --claude PATH     Copy Claude Code plugin adapter to PATH
  --consumer-only   With --codex, install only remogram-consumer
  --all             --cursor and --codex (default when no flags)
  -h, --help        Show this help
EOF
  if [[ -d "${CANONICAL}/remogram-dogfood" ]]; then
    cat <<'EOF'
  --dogfood         Install internal maintainer skills (see scripts/dogfood-skills.list)
                    to .cursor/skills/ and ~/.codex/skills/ when --codex
EOF
  fi
}

copy_skill() {
  local name="$1"
  local dest="$2"
  if [[ ! -d "${CANONICAL}/${name}" ]]; then
    echo "skip ${name} (not in ${CANONICAL})" >&2
    return 0
  fi
  rm -rf "${dest}/${name}"
  cp -R "${CANONICAL}/${name}" "${dest}/${name}"
  echo "installed ${name} -> ${dest}/${name}"
}

install_dogfood_skills() {
  local dest="$1"
  for skill in "${DOGFOOD_SKILLS[@]}"; do
    copy_skill "$skill" "$dest"
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cursor) DO_CURSOR=1; shift ;;
    --codex) DO_CODEX=1; shift ;;
    --claude) DO_CLAUDE=1; CLAUDE_DEST="$2"; shift 2 ;;
    --dogfood) DO_DOGFOOD=1; shift ;;
    --consumer-only) CONSUMER_ONLY=1; shift ;;
    --all) DO_CURSOR=1; DO_CODEX=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ "$DO_CURSOR" -eq 0 && "$DO_CODEX" -eq 0 && "$DO_CLAUDE" -eq 0 ]]; then
  DO_CURSOR=1
  DO_CODEX=1
fi

if [[ "$DO_CURSOR" -eq 1 ]]; then
  mkdir -p "$CURSOR_DEST"
  copy_skill remogram-core "$CURSOR_DEST"
  if [[ "$DO_DOGFOOD" -eq 1 ]]; then
    install_dogfood_skills "$CURSOR_DEST"
  fi
fi

if [[ "$DO_CODEX" -eq 1 ]]; then
  mkdir -p "$CODEX_DEST"
  copy_skill remogram-consumer "$CODEX_DEST"
  if [[ "$CONSUMER_ONLY" -eq 0 ]]; then
    copy_skill remogram-core "$CODEX_DEST"
  fi
  if [[ "$DO_DOGFOOD" -eq 1 ]]; then
    install_dogfood_skills "$CODEX_DEST"
  fi
fi

if [[ "$DO_CLAUDE" -eq 1 ]]; then
  if [[ -z "$CLAUDE_DEST" ]]; then
    echo "--claude requires a destination path" >&2
    exit 1
  fi
  PLUGIN_SRC="${ROOT}/tools/remogram-agent-support/adapters/claude-code-plugin"
  rm -rf "$CLAUDE_DEST"
  mkdir -p "$CLAUDE_DEST"
  cp -R "${PLUGIN_SRC}/." "$CLAUDE_DEST/"
  mkdir -p "${CLAUDE_DEST}/skills"
  for skill in remogram-consumer remogram-core; do
    copy_skill "$skill" "${CLAUDE_DEST}/skills"
  done
  if [[ "$DO_DOGFOOD" -eq 1 ]]; then
    install_dogfood_skills "${CLAUDE_DEST}/skills"
  fi
  echo "Claude plugin installed at ${CLAUDE_DEST}"
fi

echo "Done."
