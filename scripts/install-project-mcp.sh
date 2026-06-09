#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLE="$ROOT/.cursor/mcp.json.example"
TARGET="$ROOT/.cursor/mcp.json"

if [[ ! -f "$EXAMPLE" ]]; then
  echo "Missing $EXAMPLE" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"
cp "$EXAMPLE" "$TARGET"
echo "Installed $TARGET"
echo "Reload MCP in Cursor (Settings → MCP → remogram)."
