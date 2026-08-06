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

## CI (GitHub Actions) — not yet wired

`.github/workflows/deploy.yml` builds/tests on push to `main` then deploys to
S3 + invalidates CloudFront. It needs, and does not yet have:
- an auth path — either a GitHub **OIDC** provider + IAM role (set
  `secrets.AWS_ROLE_ARN`), or IAM access keys as repo secrets (and switch the
  workflow's `configure-aws-credentials` to key-based);
- secrets `S3_BUCKET=client.federation2.com`, `CF_DIST_ID=E3AT4FJ48938JC`;
- vars `VITE_WS_URL`, `VITE_PKG_URL`, `VITE_PKG_VERSION`.

Until wired, deploy manually with `scripts/deploy.sh`.
