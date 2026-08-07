export interface AppEnv {
  VITE_WS_URL: string;
  VITE_PKG_URL: string;
  VITE_PKG_VERSION: string;
  // Marks the test/dev build (VITE_SHOW_TOOLBAR=true, set on the test CodeBuild
  // project only). Enables test-only conveniences: mudlet-web's stock power-user
  // toolbar buttons (scripts, files, settings, …) and the bundled `run-lua-code`
  // package. Unset on prod, so prod stays minimal. Optional — defaults false.
  showDevToolbar: boolean;
  // GA4 measurement id (e.g. G-XXXXXXXXXX). Set ONLY on the prod CodeBuild
  // project, so analytics fire on client.federation2.com but never on
  // client-test or in local/dev builds. Empty string when unset -> no analytics
  // (see initAnalytics in src/analytics.ts).
  gaId: string;
}

export const readEnv = (): AppEnv => ({
  VITE_WS_URL: import.meta.env.VITE_WS_URL,
  VITE_PKG_URL: import.meta.env.VITE_PKG_URL,
  VITE_PKG_VERSION: import.meta.env.VITE_PKG_VERSION,
  showDevToolbar: import.meta.env.VITE_SHOW_TOOLBAR === 'true',
  gaId: import.meta.env.VITE_GA_ID ?? '',
});
