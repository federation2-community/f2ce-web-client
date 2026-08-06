import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mudix from '@mudlet/mudlet-web/vite';

// Branded client for Federation 2 Community Edition, built on
// @mudlet/mudlet-web. `mudix()` wires up the library's own Vite needs (wasm
// assets, workers, node polyfills, etc.); `react()` handles JSX/Fast Refresh
// for our app shell. Served at the root of its own dedicated subdomain
// (client.federation2.com), so built asset paths are rooted at '/'.
export default defineConfig({
  base: '/',
  plugins: [mudix(), react()],
});
