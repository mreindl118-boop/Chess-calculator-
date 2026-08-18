import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { useChess } from './state/chessStore';
import { useNav, type View } from './state/navStore';
import { useSettings } from './state/settingsStore';
import { useProfiles } from './state/profilesStore';
import { HomeView } from './views/HomeView';
import { PlayView } from './views/PlayView';
import { CheckersView } from './views/CheckersView';
import { AnalysisView } from './views/AnalysisView';
import { LibraryView } from './views/LibraryView';
import { StatsView } from './views/StatsView';
import { PuzzlesView } from './views/PuzzlesView';
import { SettingsView } from './views/SettingsView';
import { UpdateToast } from './components/UpdateToast';

const TABS: Array<{ view: View; label: string; icon: string }> = [
  { view: 'home', label: 'Play', icon: '♞' },
  { view: 'analysis', label: 'Analyze', icon: '🧪' },
  { view: 'library', label: 'Library', icon: '📚' },
  { view: 'stats', label: 'Stats', icon: '📈' },
  { view: 'settings', label: 'Settings', icon: '⚙' },
];

export default function App() {
  const nav = useNav();
  const settings = useSettings();
  const profiles = useProfiles();

  useEffect(() => {
    void settings.load();
    void profiles.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Android hardware back = in-app back.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const sub = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (!useNav.getState().back() && !canGoBack) void CapApp.exitApp();
    });
    return () => {
      void sub.then((h) => h.remove());
    };
  }, []);

  // Desktop keyboard navigation for move review.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const { view } = useNav.getState();
      if (view === 'play') {
        const chess = useChess.getState();
        if (e.key === 'ArrowLeft') chess.goToPly(chess.viewPly - 1);
        if (e.key === 'ArrowRight') chess.goToPly(chess.viewPly + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const view = nav.view;
  return (
    <div className="app">
      <main className="app-main">
        {view === 'home' && <HomeView />}
        {view === 'play' && <PlayView />}
        {view === 'checkers' && <CheckersView />}
        {view === 'analysis' && <AnalysisView />}
        {view === 'library' && <LibraryView />}
        {view === 'stats' && <StatsView />}
        {view === 'puzzles' && <PuzzlesView />}
        {view === 'settings' && <SettingsView />}
      </main>
      <nav className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.view}
            className={
              nav.view === t.view ||
              (t.view === 'home' && ['play', 'checkers', 'puzzles'].includes(nav.view))
                ? 'tab active'
                : 'tab'
            }
            onClick={() => nav.go(t.view)}
          >
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
      <UpdateToast />
    </div>
  );
}
