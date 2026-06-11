#!/usr/bin/env bash
# Publish all @remogram/* workspace packages to npm with the beta tag.
# Prereqs: npm login, @remogram org created, publish rights on the scope.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

PACKAGES=(
  packages/remogram-core
  packages/provider-gitea-api
  packages/provider-github-api
  packages/provider-gitlab-api
  packages/provider-gitea-tea
  packages/provider-github-gh
  packages/remogram-mcp
  packages/remogram-cli
)

npm whoami

for dir in "${PACKAGES[@]}"; do
  echo "Publishing $(node -p "require('./${dir}/package.json').name")..."
  npm publish --workspace "${dir}" --tag beta --access public
done

echo "Done. Install with: npm install -g @remogram/cli@beta @remogram/mcp@beta"
