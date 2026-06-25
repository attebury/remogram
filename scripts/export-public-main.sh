#!/usr/bin/env bash
# Build a public product-only tree from the current remo checkout and push to GitHub main.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-/tmp/remogram-public}"
GITHUB_REMOTE="${GITHUB_REMOTE:-git@github.com:attebury/remogram.git}"

echo "Exporting public tree to ${OUT}..."
rm -rf "${OUT}"
mkdir -p "${OUT}"

git -C "${ROOT}" archive HEAD | tar -x -C "${OUT}"

cd "${OUT}"

# Drop private dogfood / maintainer-only paths
rm -rf topo .gitea .tmp dx tools/gitea
rm -f topogram.project.json topogram.sdlc-policy.json
rm -f scripts/install-topogram-local.sh
rm -f scripts/park-topogram-skills.sh
rm -f scripts/run-gitea-gate.sh
rm -f scripts/dogfood-skills.list
rm -f scripts/remogram-smoke-compare.mjs scripts/remogram-smoke-compare-lib.mjs
rm -f scripts/remogram-smoke-compare-pr-checks.mjs scripts/remogram-smoke-compare-ref-compare.mjs
rm -f scripts/lib/forge-sidecar-http.mjs scripts/lib/forge-sidecar-pr-view.mjs scripts/lib/forge-sidecar-pr-checks.mjs
DOGFOOD_LIST="${ROOT}/scripts/dogfood-skills.list"
if [[ -f "$DOGFOOD_LIST" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="$(echo "$line" | xargs)"
    [[ -z "$line" ]] && continue
    rm -rf "tools/remogram-agent-support/skills/${line}"
    rm -rf ".cursor/skills/${line}"
  done < "$DOGFOOD_LIST"
fi
rm -f .cursor/rules/remogram-maintainer.mdc
rm -f tools/remogram-agent-support/adapters/cursor/.cursor/rules/remogram-maintainer.mdc

node <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';

function stripMaintainerBlocks(text) {
  return text.replace(/\n<!-- maintainer-only:start -->[\s\S]*?<!-- maintainer-only:end -->\n?/gm, '\n');
}

for (const path of ['AGENTS.md', 'README.md', 'tools/remogram-agent-support/README.md']) {
  writeFileSync(path, stripMaintainerBlocks(readFileSync(path, 'utf8')));
}
NODE

# Keep scripts/lib/smoke-payload-metrics.mjs for fixture tests; strip smoke npm scripts
node <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
for (const key of Object.keys(pkg.scripts || {})) {
  if (key.startsWith('smoke:')) delete pkg.scripts[key];
}
writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
NODE

# Tests use process.cwd() as a git repo for ref_compare/sync_plan fixtures
git init -b main >/dev/null
git add -A
git -c user.email='export@remogram.local' -c user.name='remogram-export' commit -m 'public export snapshot' >/dev/null

echo "Running preflight in export tree..."
npm ci
npm test
npm run test:coverage

echo "Secret scan (full history)..."
npm run security:secrets -- --full-history

echo "Verifying npm pack..."
npm pack --workspace @remogram/mcp --dry-run >/dev/null
npm pack --workspace @remogram/cli --dry-run >/dev/null

echo "Public export ready at ${OUT} (commit: $(git rev-parse HEAD))"
echo "To push: cd ${OUT} && git remote add origin ${GITHUB_REMOTE} && git push -u origin main --force"
