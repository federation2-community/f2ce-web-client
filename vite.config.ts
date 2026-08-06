import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import mudix from '@mudlet/mudlet-web/vite';

// Branded client for Federation 2 Community Edition, built on
// @mudlet/mudlet-web. `mudix()` wires up the library's own Vite needs (wasm
// assets, workers, node polyfills, etc.); `react()` handles JSX/Fast Refresh
// for our app shell. Served under /play/beta/ (see fedWeb CloudFront
// routing), so all built asset paths must be rooted there.
export default defineConfig({
  base: '/play/beta/',
  plugins: [mudix(), react()],
});
