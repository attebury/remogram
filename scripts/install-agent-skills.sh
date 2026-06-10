#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANONICAL="${ROOT}/tools/remogram-agent-support/skills"
CURSOR_DEST="${ROOT}/.cursor/skills"
CODEX_DEST="${HOME}/.codex/skills"
CLAUDE_DEST=""
DO_CURSOR=0
DO_CODEX=0
DO_CLAUDE=0
CONSUMER_ONLY=0

usage() {
  cat <<'EOF'
Install remogram agent skills from canonical tools/remogram-agent-support/skills/.

Usage: install-agent-skills.sh [options]

Options:
  --cursor          Sync remogram-core + remogram-dogfood to .cursor/skills/
  --codex           Copy remogram-consumer (+ core) to ~/.codex/skills/
  --claude PATH     Copy Claude Code plugin adapter to PATH
  --consumer-only   With --codex, install only remogram-consumer
  --all             --cursor and --codex (default when no flags)
  -h, --help        Show this help
EOF
}

copy_skill() {
  local name="$1"
  local dest="$2"
  rm -rf "${dest}/${name}"
  cp -R "${CANONICAL}/${name}" "${dest}/${name}"
  echo "installed ${name} -> ${dest}/${name}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cursor) DO_CURSOR=1; shift ;;
    --codex) DO_CODEX=1; shift ;;
    --claude) DO_CLAUDE=1; CLAUDE_DEST="$2"; shift 2 ;;
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
  copy_skill remogram-dogfood "$CURSOR_DEST"
fi

if [[ "$DO_CODEX" -eq 1 ]]; then
  mkdir -p "$CODEX_DEST"
  copy_skill remogram-consumer "$CODEX_DEST"
  if [[ "$CONSUMER_ONLY" -eq 0 ]]; then
    copy_skill remogram-core "$CODEX_DEST"
    copy_skill remogram-dogfood "$CODEX_DEST"
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
  for skill in remogram-consumer remogram-core remogram-dogfood; do
    copy_skill "$skill" "${CLAUDE_DEST}/skills"
  done
  echo "Claude plugin installed at ${CLAUDE_DEST}"
fi

echo "Done."
