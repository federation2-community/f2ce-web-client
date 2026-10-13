#!/usr/bin/env bash
# Upload dist/ to s3://$S3_BUCKET with cache headers. Used by buildspec.yml and
# scripts/deploy.sh.
#
# assets/ files are content-hashed, so they are cached forever. Everything else
# (index.html, vfs-sw.js, libpcre2.wasm, ...) keeps its name across builds and
# must be revalidated on every load; without an explicit header, browsers guess
# a freshness lifetime from Last-Modified and keep serving the old index.html
# (and the f2ce-tools version baked into it) for days after a deploy.
#
# .wasm needs its own pass so it keeps Content-Type application/wasm.
set -euo pipefail
: "${S3_BUCKET:?set S3_BUCKET}"
DIST_DIR="${1:-dist}"
IMMUTABLE="public, max-age=31536000, immutable"
REVALIDATE="no-cache"

# Assets first, so a new index.html never references files not yet uploaded.
aws s3 sync "$DIST_DIR/assets/" "s3://$S3_BUCKET/assets/" --delete \
  --exclude '*.wasm' --cache-control "$IMMUTABLE"
aws s3 sync "$DIST_DIR/assets/" "s3://$S3_BUCKET/assets/" \
  --exclude '*' --include '*.wasm' --content-type application/wasm --cache-control "$IMMUTABLE"

aws s3 sync "$DIST_DIR/" "s3://$S3_BUCKET/" --delete \
  --exclude 'assets/*' --exclude '*.wasm' --cache-control "$REVALIDATE"
aws s3 sync "$DIST_DIR/" "s3://$S3_BUCKET/" \
  --exclude '*' --include '*.wasm' --exclude 'assets/*' --content-type application/wasm --cache-control "$REVALIDATE"
