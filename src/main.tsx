import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MudletWebApp } from '@mudlet/mudlet-web';
import '@mudlet/mudlet-web/styles.css';

import { buildBrand } from './brand';
import { readEnv } from './env';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root element not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <MudletWebApp brand={buildBrand(readEnv())} />
  </StrictMode>,
);
