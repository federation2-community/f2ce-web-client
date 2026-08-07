# Deploying f2ce-web-client

The app is a static Vite build (`base:'/'`) served from **`client.federation2.com`**
— its own S3 static-website bucket behind a dedicated CloudFront distribution,
using the existing `*.federation2.com` wildcard ACM cert.

| Resource | Value |
|---|---|
| S3 bucket | `client.federation2.com` (us-west-2, static website hosting, public-read) |
| CloudFront distribution | `E3AT4FJ48938JC` |
| DNS | Route53 A-alias `client.federation2.com` → the distribution |
| Cert | reused `*.federation2.com` wildcard (us-east-1) |

Initial provisioning is scripted (bucket + website + policy + CloudFront +
Route53) in the ops script kept alongside the workspace (not committed here, as
it carries account-specific ARNs).

## Environment (build-time)

Set in `.env` (see `.env.example`). These bake into the static build:

- `VITE_WS_URL` — the proxy WebSocket URL (also used as `proxyUrl` for Lua HTTP).
  Test: `wss://ws-test.federation2.com/`. Prod: `wss://ws.federation2.com/`.
- `VITE_PKG_URL` / `VITE_PKG_VERSION` — the `f2ce-tools` release the client
  preinstalls, fetched through the proxy's `/?url=` forwarder.
- `VITE_GA_ID` — GA4 measurement id (`G-…`). **Prod only:** set it on the prod
  CodeBuild project so Google Analytics fires on `client.federation2.com`;
  leave it unset on the test project and locally, where the loader no-ops.

## Redeploy (manual)

```bash
npm run build
AWS_PROFILE=fed S3_BUCKET=client.federation2.com CF_DIST_ID=E3AT4FJ48938JC bash scripts/deploy.sh
```

`scripts/deploy.sh` syncs `dist/` to the bucket (two-pass, so `.wasm` keeps
`Content-Type: application/wasm`) and invalidates the distribution.

## Test → prod flip

The subdomain, cert, distribution, and DNS stay identical. To point the beta at
the live game:
1. Rebuild with `VITE_WS_URL=wss://ws.federation2.com/` and redeploy.
2. On the **prod** proxy, set `$ORIGIN=https://client.federation2.com`
   (`restart_node.sh`) so the WS gate + `/?url=` CORS header match this origin,
   and keep the existing xterm origin in `WS_ALLOWED_ORIGINS`. Redeploy the proxy.

(On **test** the proxy is currently permissive, so no proxy change is needed
there.)

## CI (AWS CodeBuild, GitHub callback) — matches the other Fed2 repos

Deploys the same way `fedWeb`/the game do: a **GitHub callback triggers AWS
CodeBuild**, which builds and deploys **in-account under its IAM service role**
— no GitHub-side AWS credentials (no OIDC provider, no access keys). The build
recipe is `buildspec.yml` (build → two-pass S3 sync → CloudFront invalidation).

To wire it (one-time, AWS side):
1. Create a CodeBuild project (or CodePipeline with a GitHub source) pointed at
   this repo's `main`, using `buildspec.yml`.
2. Give the CodeBuild **service role** permissions scoped to this deploy:
   `s3:PutObject`/`s3:DeleteObject`/`s3:ListBucket` on the
   `client.federation2.com` bucket, and `cloudfront:CreateInvalidation` on
   distribution `E3AT4FJ48938JC`.
3. Set project env vars for the target environment (`VITE_WS_URL`,
   `VITE_PKG_URL`, `VITE_PKG_VERSION`, `S3_BUCKET`, `CF_DIST_ID`, and on prod
   `VITE_GA_ID`) — the `buildspec.yml` carries test defaults; override for prod.

Until the CodeBuild project exists, deploy manually with `scripts/deploy.sh`.
