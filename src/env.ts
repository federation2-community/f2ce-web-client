export interface AppEnv {
  VITE_WS_URL: string;
  VITE_PKG_URL: string;
  VITE_PKG_VERSION: string;
}

export const readEnv = (): AppEnv => ({
  VITE_WS_URL: import.meta.env.VITE_WS_URL,
  VITE_PKG_URL: import.meta.env.VITE_PKG_URL,
  VITE_PKG_VERSION: import.meta.env.VITE_PKG_VERSION,
});
