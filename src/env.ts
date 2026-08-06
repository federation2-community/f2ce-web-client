export interface AppEnv {
  VITE_WS_URL: string;
  VITE_PKG_URL: string;
  VITE_PKG_VERSION: string;
  // When true, show mudlet-web's stock power-user toolbar buttons (scripts,
  // files, settings, …). Set on the test CodeBuild project only; unset on
  // prod, so prod keeps the minimal branded toolbar. Optional — defaults false.
  showDevToolbar: boolean;
}

export const readEnv = (): AppEnv => ({
  VITE_WS_URL: import.meta.env.VITE_WS_URL,
  VITE_PKG_URL: import.meta.env.VITE_PKG_URL,
  VITE_PKG_VERSION: import.meta.env.VITE_PKG_VERSION,
  showDevToolbar: import.meta.env.VITE_SHOW_TOOLBAR === 'true',
});
