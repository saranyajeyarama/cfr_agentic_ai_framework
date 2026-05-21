import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {resetIfNewBuild} from './lib/buildReset';

// Cache-bust local state on a new deploy. Must run BEFORE React mounts
// so the per-store sessionStorage initializers see the cleared state.
const _reset = resetIfNewBuild();
if (_reset.previous !== _reset.current) {
  // eslint-disable-next-line no-console
  console.info(
    `[tiger] new build detected (was ${_reset.previous ?? 'none'} → now ${_reset.current}); ` +
    `cleared ${_reset.cleared} cached entries.`,
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
