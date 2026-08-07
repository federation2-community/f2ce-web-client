// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';

import { initAnalytics } from './analytics';

const GTAG_SRC = 'script[src*="googletagmanager.com/gtag/js"]';

describe('initAnalytics', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    delete (window as unknown as { gtag?: unknown }).gtag;
    delete (window as unknown as { dataLayer?: unknown }).dataLayer;
  });

  it('no-ops when gaId is empty (non-prod builds inject nothing)', () => {
    expect(initAnalytics('')).toBe(false);
    expect(document.querySelector(GTAG_SRC)).toBeNull();
    expect(window.gtag).toBeUndefined();
    expect(window.dataLayer).toBeUndefined();
  });

  it('injects the GA4 gtag.js snippet and configures the measurement id', () => {
    expect(initAnalytics('G-TEST123')).toBe(true);

    const script = document.querySelector(GTAG_SRC) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    expect(script!.async).toBe(true);
    expect(script!.src).toContain('id=G-TEST123');

    expect(typeof window.gtag).toBe('function');
    // 'js' (timestamp) and 'config' commands are queued on dataLayer, each as
    // an array-like arguments object (Google's canonical snippet behavior).
    const queued = (window.dataLayer as ArrayLike<unknown>[]).map((e) => Array.from(e));
    expect(queued.some((args) => args[0] === 'js')).toBe(true);
    expect(queued).toContainEqual(['config', 'G-TEST123']);
  });

  it('does not double-initialise if called again', () => {
    expect(initAnalytics('G-TEST123')).toBe(true);
    expect(initAnalytics('G-TEST123')).toBe(false);
    expect(document.querySelectorAll(GTAG_SRC).length).toBe(1);
  });
});
