import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AiAnalysisPage } from './pages/AiAnalysisPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { MarketAnalysisPage } from './pages/MarketAnalysisPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SettingsPage } from './pages/SettingsPage';
import { WatchlistPage } from './pages/WatchlistPage';
import { ErrorBoundary } from './components/ErrorBoundary';

/**
 * Route table.
 *
 * Every page renders inside `AppShell`, so navigation, the demo banner and the
 * connection indicator are present on all of them. The error boundary wraps the
 * whole tree: a render error shows a recoverable message instead of a blank
 * screen.
 */
export function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="market" element={<MarketAnalysisPage />} />
          <Route path="ai-analysis" element={<AiAnalysisPage />} />
          <Route path="watchlist" element={<WatchlistPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
