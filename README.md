# f2ce-web-client

A branded browser client for **Federation 2 Community Edition** — built on
[`@mudlet/mudlet-web`](https://github.com/Mudlet/mudlet-web), configured via
a single `BrandConfig` (see `src/brand.ts`). It talks to the game through the
`f2ce-proxy` telnet<->websocket bridge, not directly to `fed2d`.

## License

GPL-2.0-or-later. This project links against and redistributes
`@mudlet/mudlet-web`, itself GPL-2.0-or-later — see `LICENSE` for the full
text and the upstream project for its own license terms.

## Setup

```bash
cp .env.example .env   # then edit VITE_WS_URL / VITE_PKG_URL / VITE_PKG_VERSION
npm install
```

## Scripts

```bash
npm run dev       # start the Vite dev server
npm run build     # type-check + production build (dist/, rooted at / — served at client.federation2.com)
npm run preview   # preview the production build locally
npm test          # run the Vitest unit tests
```
