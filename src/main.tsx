import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MudletWebApp } from '@mudlet/mudlet-web';
import '@mudlet/mudlet-web/styles.css';
import './landing.css';

import { buildBrand } from './brand';
import { readEnv } from './env';
import { initAnalytics } from './analytics';

const env = readEnv();

// GA4 — no-ops unless VITE_GA_ID is set (prod build only); see analytics.ts.
initAnalytics(env.gaId);

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root element not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <MudletWebApp brand={buildBrand(env)} />
  </StrictMode>,
);
