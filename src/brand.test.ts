import { describe, it, expect, vi } from 'vitest';

// `Landing` pulls a real (value) import of `setSessionCredentials` from
// `@mudlet/mudlet-web`, which in turn drags in the whole library bundle
// (including its wasm-based Lua runtime) — fine in the browser/jsdom, but
// this suite runs in the default node env and only cares about identity
// (`b.Landing` is set), so stub the package rather than loading it for real.
vi.mock('@mudlet/mudlet-web', () => ({ setSessionCredentials: vi.fn() }));

import { buildBrand } from './brand';

const env = {
  VITE_WS_URL: 'wss://ws-test.federation2.com/',
  VITE_PKG_VERSION: '3.2.3',
  VITE_PKG_URL:
    'https://ws-test.federation2.com/?url=https%3A%2F%2Fgithub.com%2Ffederation2-community%2Ff2ce-tools%2Freleases%2Fdownload%2Fv3.2.3%2Ff2ce-tools.mpackage',
  showDevToolbar: false,
};

describe('buildBrand', () => {
  const b = buildBrand(env);

  it('routes Lua HTTP through the proxy (proxyUrl === mud url)', () => {
    // `mud` and `mud.url` are optional in BrandConfig (a stock, unbranded
    // client leaves them unset) — non-null asserted here since this test is
    // specifically about the branded values buildBrand always sets.
    expect(b.mud!.url).toBe(env.VITE_WS_URL);
    expect(b.proxyUrl).toBe(env.VITE_WS_URL);
  });

  it('uses a single browser profile', () => {
    expect(b.profileMode).toBe('single');
  });

  it('preinstalls f2ce-tools, non-removable, version wired from env', () => {
    const p = b.packages![0];
    expect(p.name).toBe('f2ce-tools');
    expect(p.version).toBe('3.2.3');
    expect(p.removable).toBe(false);
    expect(p.url).toBe(env.VITE_PKG_URL);
  });

  it('hides the stock toolbar buttons Scripts..Settings by default (prod)', () => {
    expect(b.toolbar!.hide).toContain('scripts');
    expect(b.toolbar!.hide).toContain('settings');
  });

  it('restores the stock toolbar buttons when showDevToolbar is set (test build)', () => {
    const dev = buildBrand({ ...env, showDevToolbar: true });
    expect(dev.toolbar!.hide).toEqual([]);
  });

  it('links source for GPL', () => {
    expect(b.repoUrl).toContain('f2ce-web-client');
  });

  it('supplies a custom Landing for interactive character creation', () => {
    expect(b.Landing).toBeDefined();
  });
});
