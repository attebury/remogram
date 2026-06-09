#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm install

# npm unlink removes the global package but can leave stale bin symlinks (EEXIST on re-link).
NPM_PREFIX="$(npm prefix -g)"
for pkg in remogram @remogram/cli @remogram/mcp; do
  npm unlink -g "$pkg" 2>/dev/null || true
done
rm -f "$NPM_PREFIX/bin/remogram" "$NPM_PREFIX/bin/remogram-mcp"

npm link --workspace @remogram/cli
npm link --workspace @remogram/mcp

echo "Linked remogram and remogram-mcp globally."
echo "  remogram     -> $(command -v remogram)"
echo "  remogram-mcp -> $(command -v remogram-mcp)"
