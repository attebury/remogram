#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_PREFIX="$(mktemp -d)"
PACK_DIR="$TMP_PREFIX/packs"
PREFIX="$TMP_PREFIX/npm-global"
mkdir -p "$PACK_DIR" "$PREFIX"

cleanup() { rm -rf "$TMP_PREFIX"; }
trap cleanup EXIT

cd "$ROOT/packages/remogram-core" && npm pack --pack-destination "$PACK_DIR" >/dev/null
cd "$ROOT/packages/remogram-cli" && npm pack --pack-destination "$PACK_DIR" >/dev/null
for pkg in provider-gitea-api provider-github-api provider-gitlab-api provider-gitea-tea provider-github-gh; do
  cd "$ROOT/packages/$pkg" && npm pack --pack-destination "$PACK_DIR" >/dev/null
done

CORE_TGZ="$(ls "$PACK_DIR"/remogram-core-*.tgz | head -1)"
CLI_TGZ="$(ls "$PACK_DIR"/remogram-cli-*.tgz | head -1)"
TGZ_LIST=("$CORE_TGZ" "$CLI_TGZ")
for pkg in provider-gitea-api provider-github-api provider-gitlab-api provider-gitea-tea provider-github-gh; do
  TGZ_LIST+=("$(ls "$PACK_DIR"/remogram-${pkg}-*.tgz | head -1)")
done

npm install --prefix "$PREFIX" "${TGZ_LIST[@]}" >/dev/null

export PATH="$PREFIX/bin:$PATH"
remogram contract export --json >/dev/null
echo "global-install-smoke: ok"
