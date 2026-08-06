# Manual live checklist (test server, real fed2d)

There is no local game engine, so the automated `test:e2e` suite (`e2e/smoke.spec.ts`)
only boots the built app against a static `vite preview` server and checks that the
branded Landing renders — it never dials out. Everything below requires a live
connection to the test engine and must be exercised by hand.

This mirrors the Task 0 spike (`.sdd/task-0-*`), which already passed against
`ws-test.federation2.com`; re-run it here whenever the client, proxy, or engine
change in a way that could affect the connect path.

## Setup

1. In `.env`, confirm (or set):
   ```
   VITE_WS_URL=wss://ws-test.federation2.com/
   VITE_PKG_VERSION=3.2.3
   VITE_PKG_URL=https://ws-test.federation2.com/?url=https%3A%2F%2Fgithub.com%2Ffederation2-community%2Ff2ce-tools%2Freleases%2Fdownload%2Fv3.2.3%2Ff2ce-tools.mpackage
   ```
2. Confirm the test proxy (`ws-test.federation2.com`) is permissive enough for local
   dev — either it allows CORS/WS from `localhost`, or it allowlists `localhost` as an
   accepted origin. If it rejects the browser's `Origin` header, the WS handshake will
   fail before any GMCP negotiation happens.
3. `npm run dev` (or `npm run build && npm run preview`) and open the app at
   `/`.

## Checklist

- [ ] **WS connects with no `tls.established` step.** The client dials
      `wss://ws-test.federation2.com/` directly (TLS terminates at the proxy); the
      connection should reach `OPEN` without any client-side "establishing TLS"
      handshake step of its own. Watch the browser devtools Network/WS frames tab.
- [ ] **GMCP negotiates.** After connect, confirm `IAC WILL GMCP` / `IAC DO GMCP` (or
      the client's GMCP-ready log/state) completes — check for GMCP packages
      (`Char`, `Room`, etc.) arriving once logged in.
- [ ] **TTYPE negotiates.** Confirm the client answers `IAC DO TTYPE` with its
      terminal-type subnegotiation (no hang waiting on TTYPE).
- [ ] **`f2ce-tools` installs via the proxy `/?url=` forwarder.** Trigger the package
      install path (uses `VITE_PKG_URL`, which routes through
      `ws-test.federation2.com/?url=<github release URL>`); confirm the `.mpackage`
      downloads and installs without a CORS or mixed-content error.
- [ ] **Muxlet GUI renders.** After the package installs, confirm the Muxlet-based
      GUI (map/status panels, etc.) actually renders in the client — not just blank
      panels.
- [ ] **"Create a new character" reaches fed2d's `new` prompt.** From the Landing,
      click "Create a new character" (`Landing.tsx`'s `createCharacter`, which opens
      the connection with no staged credentials via
      `setSessionCredentials(id, null)`). Confirm fed2d's raw interactive login
      prompt appears and typing `new` starts the account-creation flow.
- [ ] **Reconnect after a drop.** Kill the WS connection (devtools "offline", or
      close the underlying socket) and confirm the client detects the drop and
      successfully reconnects/resumes rather than hanging in a disconnected state.

## Notes

- This checklist is a substitute for an automated live-engine test, which would be
  flaky in CI (no local `fed2d`, dependent on `ws-test.federation2.com` uptime).
- If any step regresses, prefer fixing the regression over adding CI flakiness by
  trying to script this path — see `playwright.config.ts` / `e2e/smoke.spec.ts` for
  the no-engine boundary this repo intentionally keeps.
