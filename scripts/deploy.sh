#!/usr/bin/env bash
# Manual redeploy: sync the built dist/ to the client.federation2.com bucket and
# invalidate the CloudFront distribution. Cache headers: see sync-dist.sh.
#
#   npm run build
#   AWS_PROFILE=fed S3_BUCKET=client.federation2.com CF_DIST_ID=E3AT4FJ48938JC bash scripts/deploy.sh
set -euo pipefail
export AWS_PAGER=""
: "${S3_BUCKET:?set S3_BUCKET}"
: "${CF_DIST_ID:?set CF_DIST_ID}"
DIST_DIR="$(cd "$(dirname "$0")/.." && pwd)/dist"
[ -d "$DIST_DIR" ] || { echo "no dist/ — run 'npm run build' first" >&2; exit 1; }

bash "$(dirname "$0")/sync-dist.sh" "$DIST_DIR"
aws cloudfront create-invalidation --distribution-id "$CF_DIST_ID" --paths '/*' --query "Invalidation.Status" --output text
echo "deployed + invalidation requested"
