#!/usr/bin/env bash
# Package a compiled Creative Soundwerks 2 release as a standalone upload/extract ZIP.
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
OUTPUT="$ROOT/out/creative-soundwerks2-install.zip"
[[ $# -eq 0 ]] || OUTPUT="$1"
case "$OUTPUT" in /*) ;; *) OUTPUT="$ROOT/$OUTPUT";; esac
for file in package.json package-lock.json .env.example install.sh \
 scripts/install-ubuntu.sh deploy/creative-soundwerks.service \
 deploy/nginx-https.conf.template apps/api/dist/index.js \
 apps/web/dist/index.html apps/api/src/migrate.ts apps/api/src/db.ts \
 apps/api/src/env.ts apps/api/sql/001_init.sql \
 apps/api/sql/002_media_library.sql apps/api/sql/003_images.sql; do
 [[ -f "$ROOT/$file" ]] || { echo "Missing release component: $file" >&2; exit 1; }
done
command -v zip >/dev/null || { echo "Install zip to build release archives" >&2; exit 1; }
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
mkdir -p "$TEMP/scripts" "$TEMP/deploy" "$TEMP/apps/api/dist" "$TEMP/apps/api/src" \
 "$TEMP/apps/api/sql" "$TEMP/apps/web/dist" "$(dirname "$OUTPUT")"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/.env.example" "$ROOT/install.sh" "$TEMP/"
cp "$ROOT/scripts/install-ubuntu.sh" "$TEMP/scripts/"
cp "$ROOT/deploy/creative-soundwerks.service" "$ROOT/deploy/nginx-https.conf.template" "$TEMP/deploy/"
cp "$ROOT/apps/api/package.json" "$TEMP/apps/api/"
cp "$ROOT/apps/web/package.json" "$TEMP/apps/web/"
cp "$ROOT/apps/api/src/migrate.ts" "$ROOT/apps/api/src/db.ts" "$ROOT/apps/api/src/env.ts" "$TEMP/apps/api/src/"
cp "$ROOT"/apps/api/sql/*.sql "$TEMP/apps/api/sql/"
cp -a "$ROOT/apps/api/dist/." "$TEMP/apps/api/dist/"
cp -a "$ROOT/apps/web/dist/." "$TEMP/apps/web/dist/"
# ZIP has a flat root: extracting creates install.sh directly, no extra nested directory.
rm -f "$OUTPUT"
(cd "$TEMP" && zip -qr "$OUTPUT" .)
echo "Created $(basename "$OUTPUT")"
