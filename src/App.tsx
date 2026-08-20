import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { useChess } from './state/chessStore';
import { useAnalysis } from './state/analysisStore';
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
import { warmUpEngines } from './state/engineHub';

function TabIcon({ name }: { name: View }) {
  switch (name) {
    case 'home': // pawn
      return (
        <svg className="tab-icon-svg" viewBox="0 0 24 24">
          <circle cx={12} cy={6.4} r={2.9} />
          <path d="M9.8 9.5 C8.6 12 8.9 14 10 15.4 L8.6 18.6 L15.4 18.6 L14 15.4 C15.1 14 15.4 12 14.2 9.5 M6.8 21.2 L17.2 21.2" />
        </svg>
      );
    case 'analysis': // magnifier
      return (
        <svg className="tab-icon-svg" viewBox="0 0 24 24">
          <circle cx={10.5} cy={10.5} r={6.2} />
          <path d="M15.2 15.2 L20.5 20.5 M8 10.5 L13 10.5 M10.5 8 L10.5 13" />
        </svg>
      );
    case 'library': // book
      return (
        <svg className="tab-icon-svg" viewBox="0 0 24 24">
          <path d="M4 5.5 Q8 3.8 12 5.5 L12 19.5 Q8 17.8 4 19.5 Z M20 5.5 Q16 3.8 12 5.5 L12 19.5 Q16 17.8 20 19.5 Z" />
        </svg>
      );
    case 'stats': // chart
      return (
        <svg className="tab-icon-svg" viewBox="0 0 24 24">
          <path d="M4 20 L20 20 M6.5 20 L6.5 13 M11.2 20 L11.2 8 M15.9 20 L15.9 11 M20 20 L20 5.5" />
        </svg>
      );
    default: // gear
      return (
        <svg className="tab-icon-svg" viewBox="0 0 24 24">
          <circle cx={12} cy={12} r={3.1} />
          <path d="M12 3.4 L12 6 M12 18 L12 20.6 M3.4 12 L6 12 M18 12 L20.6 12 M5.9 5.9 L7.8 7.8 M16.2 16.2 L18.1 18.1 M18.1 5.9 L16.2 7.8 M7.8 16.2 L5.9 18.1" />
        </svg>
      );
  }
}

const TABS: Array<{ view: View; label: string }> = [
  { view: 'home', label: 'Play' },
  { view: 'analysis', label: 'Analyze' },
  { view: 'library', label: 'Games' },
  { view: 'stats', label: 'Progress' },
  { view: 'settings', label: 'Settings' },
];

export default function App() {
  const nav = useNav();
  const settings = useSettings();
  const profiles = useProfiles();

  useEffect(() => {
    void (async () => {
      await settings.load(); // engine choice depends on the threaded-engine setting
      void profiles.load();
      void warmUpEngines();
    })();
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
      } else if (view === 'analysis') {
        const a = useAnalysis.getState();
        if (a.editing) return;
        if (e.key === 'ArrowLeft') a.back();
        if (e.key === 'ArrowRight') a.forward();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const view = nav.view;
  return (
    <div className="app">
      <main className="app-main">
        <div className="view-anim" key={view}>
          {view === 'home' && <HomeView />}
          {view === 'play' && <PlayView />}
          {view === 'checkers' && <CheckersView />}
          {view === 'analysis' && <AnalysisView />}
          {view === 'library' && <LibraryView />}
          {view === 'stats' && <StatsView />}
          {view === 'puzzles' && <PuzzlesView />}
          {view === 'settings' && <SettingsView />}
        </div>
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
            <TabIcon name={t.view} />
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
      <UpdateToast />
    </div>
  );
}
