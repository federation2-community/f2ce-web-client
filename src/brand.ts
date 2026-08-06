import type { BrandConfig } from '@mudlet/mudlet-web';

import type { AppEnv } from './env';
import { Landing } from './Landing';

/**
 * The websocket endpoint drives two things at once:
 * - `mud.url` (mode: 'websocket') — the client's connection target. It's
 *   `ws(s)://`, not the MUD's native protocol, because it points at the
 *   f2ce-proxy telnet<->websocket bridge, not fed2d directly.
 * - `proxyUrl` — the *same* `ws(s)://` value. mudlet-web derives an
 *   `http(s)://.../?url=<encoded>` forwarding endpoint from it internally
 *   (swapping ws->http / wss->https) for anything needing a same-origin HTTP
 *   hop: Lua HTTP calls and, as a CORS-failure fallback, package/module
 *   downloads. Passing an `http(s)://` URL here directly is wrong — mudlet-web
 *   does that swap itself. Leaving `proxyUrl` unset falls back to a public
 *   default proxy baked into the library (`wss://mudix.delwing.workers.dev`).
 */
export function buildBrand(env: AppEnv): BrandConfig {
  return {
    appName: 'Federation 2',
    // Show the Fed2 wordmark logo in the toolbar brand area. appName renders as
    // bare text beside it; landing.css collapses that text so only the logo shows.
    logoUrl: 'https://federation2.com/assets/img/logo.png',
    tagline: 'Federation 2, in your browser',
    aboutText:
      'A branded, white-label build of Mudlet Web for Federation 2 Community Edition — a text-based, telnet-style multiplayer space-trading MUD.',
    repoUrl: 'https://github.com/federation2-community/f2ce-web-client',

    proxyUrl: env.VITE_WS_URL,

    mud: {
      mode: 'websocket',
      url: env.VITE_WS_URL,
      name: 'Federation 2',
      autoConnect: true,
    },

    // Single shared profile — no per-account profile switching.
    profileMode: 'single',

    // Hide mudlet-web's stock toolbar buttons — this is a dedicated
    // single-purpose UI, not a general MUD client. Kept: `connection`
    // (Reconnect/Disconnect) and `close`.
    toolbar: {
      hide: ['scripts', 'files', 'map', 'logs', 'docs', 'reportBug', 'settings', 'record'],
    },

    packages: [
      {
        name: 'f2ce-tools',
        filename: 'f2ce-tools.mpackage',
        url: env.VITE_PKG_URL,
        version: env.VITE_PKG_VERSION,
        removable: false,
      },
    ],

    // Custom landing: quick login for returning players + a "Create a new
    // character" action that drives fed2d's interactive account-creation
    // flow instead of auto-submitting credentials.
    Landing,

    themes: [
      {
        id: 'fed2',
        label: 'Federation 2',
        variables: {
          '--accent': '#2fbe78',
        },
        colorScheme: 'dark',
      },
    ],
    defaultTheme: 'fed2',
  };
}
