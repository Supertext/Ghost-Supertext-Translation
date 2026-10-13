#!/bin/sh
# Builds the Supertext SDK (TypeScript) from its GitHub repository and copies the package
# into vendor/supertext-sdk. Needed until the SDK is published on npm; then depend on
# "supertext-sdk" from npm and delete vendor/ and this script.
#
#   scripts/vendor-sdk.sh [commit-or-branch]   (default: main)
set -eu
REF="${1:-main}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet https://github.com/Supertext/Supertext-API-SDK-and-Guide "$TMP/sdk"
git -C "$TMP/sdk" checkout --quiet "$REF"
COMMIT="$(git -C "$TMP/sdk" rev-parse HEAD)"

cd "$TMP/sdk/sdk/typescript"
npm ci --ignore-scripts --no-audit --no-fund >/dev/null
npm run build >/dev/null

rm -rf "$ROOT/vendor/supertext-sdk"
mkdir -p "$ROOT/vendor/supertext-sdk"
cp -R dist README.md LICENSE "$ROOT/vendor/supertext-sdk/"
# Only what a consumer needs: no devDependencies or scripts (npm would install the SDK's
# own dev tools into a linked file: dependency).
node -e '
const pkg = require("./package.json");
delete pkg.devDependencies; delete pkg.scripts;
require("fs").writeFileSync(process.argv[1], JSON.stringify(pkg, null, 2) + "\n");
' "$ROOT/vendor/supertext-sdk/package.json"
printf '%s\n' "$COMMIT" > "$ROOT/vendor/supertext-sdk/COMMIT"
echo "vendor/supertext-sdk: supertext-sdk $(node -p "require('./package.json').version") from commit $COMMIT"
