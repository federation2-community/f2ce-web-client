// Google Analytics (GA4) loader. Deliberately env-gated: the gtag.js snippet is
// injected only when a measurement id is provided (VITE_GA_ID, read via
// src/env.ts). That variable is set ONLY on the prod CodeBuild project, so
// analytics fire on client.federation2.com but never on client-test or in
// local/dev-stack builds (where VITE_GA_ID is unset -> empty string -> no-op).
//
// The measurement id itself is not a secret (it ships in the client bundle
// wherever analytics are enabled); env-gating is about *which environment*
// reports, matching this repo's "one CodeBuild project per environment"
// convention rather than about hiding the id.

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

type GtagFn = (...args: unknown[]) => void;

/**
 * Inject the GA4 gtag.js snippet and configure `gaId`. No-ops (returning false)
 * when `gaId` is empty (non-prod builds), when there's no DOM, or when
 * analytics have already been initialised. Returns true when it wires GA up.
 */
export function initAnalytics(gaId: string): boolean {
  if (!gaId) return false;
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  if (window.gtag) return false; // already initialised

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  // Push the raw `arguments` object, exactly as Google's canonical gtag snippet
  // does (gtag.js reads array-like entries off the queue).
  const gtag: GtagFn = function () {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', gaId);
  return true;
}
