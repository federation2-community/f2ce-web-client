# Local full-stack dev/test harness

`scripts/dev-stack.sh` brings up the **whole** Federation 2 web stack on your
machine — the C++ game engine, the telnet↔websocket proxy, and this client's
vite dev server — so you can catch browser-behavior bugs (Muxlet/f2ce-tools
init, GMCP `Char.Login` timing, the terminal actually rendering, …) locally,
before deploying to client-test. The engine-only telnet e2e test in
`fed2-community` validates engine logic but can't see any of that; this
closes the gap.

## Prerequisites

Sibling checkouts of `fed2-community` (the `fed2d` engine) and `fed-node`
(the `f2ce-proxy` telnet↔websocket bridge), plus this repo — the default
layout is:

```
fed/
  fed2-community/
  fed-node/
  f2ce-web-client/   <- you are here
```

`fed2-community` needs its usual build deps (cmake, expat, sqlite3, zlib,
Berkeley DB — see its own CLAUDE.md) and a `data/game_data.sdb` to load. It
must **not** have an `is_prod` or `is_test` marker file in its repo root —
the script refuses to start otherwise, since it only ever runs the engine in
LOCAL mode.

## Usage

```bash
scripts/dev-stack.sh
```

Run it in the foreground of your own terminal (see the note on Ctrl-C
below). It will:

1. Build `fed2d` if needed (`cmake . && cmake --build .`) and start it,
   waiting (up to 90s — it loads a large DB) for `:30003` to accept
   connections.
2. `npm ci` the proxy if needed, then start `f2ce-proxy`'s `server.mjs`
   pinned at `localhost:30003`, plain `ws://` (no TLS — see below), waiting
   for `http://localhost:3001/healthz` to return 200.
3. Start this app's vite dev server, pointed at the local proxy, and print
   its URL once ready — something like:
   ```
   stack up: open http://localhost:5173/
   ```

Open that URL, log in as an existing local character (any password — see
below), and you're driving the real client against a real local engine.

Ctrl-C tears down all three processes and removes the engine's `fed2d.pid`
run-lock (so a stale lock doesn't block the next run).

> **Note:** run the script in the foreground, not backgrounded (`&`). POSIX
> shells set SIGINT/SIGQUIT to ignored for asynchronous (`&`) commands, and a
> non-interactive script can't override that via `trap` — so Ctrl-C-style
> signals silently won't reach a backgrounded instance. `kill -TERM <pid>`
> always works as a fallback and triggers the same cleanup.

## Env knobs

| Var | Default | Meaning |
|---|---|---|
| `ENGINE_DIR` | `../fed2-community` | path to the engine checkout |
| `PROXY_DIR` | `../fed-node` | path to the proxy checkout |
| `ENGINE_PORT` | `30003` | fed2d telnet port |
| `PROXY_PORT` | `3001` | f2ce-proxy http/ws port |
| `VITE_PORT` | `5173` | vite dev server port (vite bumps it if busy) |
| `PKG_URL` | 3.2.4 f2ce-tools release | the `.mpackage` to install, routed through the local proxy's `/?url=` CORS forwarder |
| `PKG_VERSION` | `3.2.4` | version string reported to mudlet-web |
| `SKIP_ENGINE_BUILD` | unset | set to `1` to skip the cmake build step entirely |
| `ENGINE_WAIT_SECS` | `90` | how long to poll for the engine port |

Logs for all three processes land under `.dev-stack-logs/` in this repo
(gitignored via the existing `*.log` rule).

## Why no TLS / any-origin CORS is fine locally

In production, Caddy terminates `wss://` in front of `f2ce-proxy`, which
itself only ever speaks plain `ws://`. Locally there's no Caddy, so the
script runs the proxy exactly as it always runs — plain `ws://` — and since
vite serves the page over `http://localhost`, `ws://` avoids any
mixed-content issue. No certs needed. The script sets `WS_ALLOWED_ORIGINS=`
(empty — allow any origin) and `CORS_ORIGIN=*` so the browser's websocket
handshake and the `/?url=` package-download forwarder both work regardless
of which port vite ends up on.

## Logging in locally

fed2d in LOCAL mode (no `is_prod`/`is_test` marker) accepts **any password**
for an existing character (`Player::IsPassword()` short-circuits to `true`).
The local `data/game_data.sdb` has a character named `Test` — log in with
name `Test` and any password.

## Playwright smoke test against the live stack

```bash
npm run test:e2e:stack
```

Runs `e2e/stack-smoke.spec.ts` via `playwright.stack.config.ts` against
whatever's already listening at `STACK_URL` (default
`http://localhost:5173` — override it if `dev-stack.sh` printed a different
port). It does **not** manage the stack's lifecycle itself — start
`scripts/dev-stack.sh` first.

The test logs in as `Test`, confirms the engine's banner/room text reaches
the browser, then confirms Muxlet/f2ce-tools actually initialized: it waits
for f2ce-tools' own UI (the Galaxy button / Groats readout) to render, then
types `f2t on` into the command input and asserts the response is
`f2ce-tools UI is on` (not `Muxlet isn't ready`, the failure message
`fed2-tools/src/aliases/f2t.lua` prints if Muxlet hasn't finished
installing). See the comment at the top of the spec for more on why that
message is used as the readiness signal, plus a TODO to switch to a stable
DOM test-id if mudlet-web/f2ce-tools ever exposes one.

This is **separate** from `npm run test:e2e` (the existing no-engine
build/preview smoke test that deploy CI relies on) and from `npm test`
(vitest unit tests) — neither of those changed, and `test:e2e:stack` is not
wired into either.
