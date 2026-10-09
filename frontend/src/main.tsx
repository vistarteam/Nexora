import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { SettingsProvider } from './context/SettingsContext';
import { SystemProvider } from './context/SystemContext';
import { ToastProvider } from './context/ToastContext';
import { WatchlistProvider } from './context/WatchlistContext';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root was not found in index.html');
}

/**
 * Provider order matters:
 *  Settings → theme + formatting must exist before anything renders.
 *  Toast    → available to every provider that reports failures.
 *  System   → bootstrap/health, consumed by the shell and pages.
 *  Watchlist→ depends on the toast layer for write feedback.
 */
createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <SettingsProvider>
        <ToastProvider>
          <SystemProvider>
            <WatchlistProvider>
              <App />
            </WatchlistProvider>
          </SystemProvider>
        </ToastProvider>
      </SettingsProvider>
    </BrowserRouter>
  </StrictMode>,
);
