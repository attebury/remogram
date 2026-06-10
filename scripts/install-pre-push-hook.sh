#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$REPO_ROOT/.git/hooks/pre-push"
BASE_REF="${REMOGRAM_SECRET_SCAN_BASE_REF:-origin/dev/scaffold}"

cat > "$HOOK" <<EOF
#!/usr/bin/env bash
set -euo pipefail

remote="\${1:-}"
if [[ "\$remote" != "origin" ]]; then
  exit 0
fi

cd "$REPO_ROOT"
echo "remogram secret scan (pre-push to origin, base=$BASE_REF)..."
npm run security:secrets -- --base "$BASE_REF" --head HEAD
EOF

chmod +x "$HOOK"
echo "Installed pre-push hook: $HOOK"
