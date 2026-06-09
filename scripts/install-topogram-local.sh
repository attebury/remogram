#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="${TOPOGRAM_ENGINE:-$ROOT/../topogram/engine}"
if [[ ! -f "$ENGINE/package.json" ]]; then
  echo "Topogram engine not found at $ENGINE" >&2
  echo "Clone sibling topogram or set TOPOGRAM_ENGINE." >&2
  exit 1
fi
cd "$ROOT"
npm install
