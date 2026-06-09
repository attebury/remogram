#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm install
npm link --workspace @remogram/cli
npm link --workspace @remogram/mcp
echo "Linked remogram and remogram-mcp globally."
