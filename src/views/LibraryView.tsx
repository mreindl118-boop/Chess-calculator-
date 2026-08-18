import { useEffect, useState } from 'react';
import { db, type SavedGame } from '../lib/db/schema';
import { useNav } from '../state/navStore';

export function LibraryView() {
  const nav = useNav();
  const [games, setGames] = useState<SavedGame[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'chess' | 'checkers'>('all');

  useEffect(() => {
    void (async () => {
      const all = await (await db()).getAllFromIndex('games', 'by-finished');
      setGames(all.reverse());
    })();
  }, []);

  const filtered = games.filter((g) => {
    if (filter !== 'all' && g.game !== filter) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      g.white.name.toLowerCase().includes(q) ||
      g.black.name.toLowerCase().includes(q) ||
      g.variant.toLowerCase().includes(q) ||
      g.result.includes(q)
    );
  });

  const remove = async (id: string) => {
    await (await db()).delete('games', id);
    setGames((gs) => gs.filter((g) => g.id !== id));
  };

  return (
    <div className="library-view">
      <h2>Game library</h2>
      <div className="library-filters">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search players, variant…"
        />
        <div className="segment">
          {(['all', 'chess', 'checkers'] as const).map((f) => (
            <button
              key={f}
              className={filter === f ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && <p className="field-hint">No games yet — finished games are saved here automatically.</p>}

      <div className="game-list">
        {filtered.map((g) => (
          <div key={g.id} className="game-card">
            <div className="game-card-main">
              <span className="game-players">
                {g.white.name} <em>vs</em> {g.black.name}
              </span>
              <span className="game-meta">
                {g.result} · {g.variant}
                {g.rated ? ' · rated' : ''} ·{' '}
                {new Date(g.finishedAt).toLocaleDateString()}
              </span>
              {g.accuracySummary && (
                <span className="game-accuracy">
                  accuracy {g.accuracySummary.w}% / {g.accuracySummary.b}%
                </span>
              )}
            </div>
            <div className="game-card-actions">
              {g.game === 'chess' && (
                <button
                  className="btn subtle"
                  onClick={() => nav.go('analysis', { gameId: g.id })}
                >
                  Analyze
                </button>
              )}
              {g.pgn && (
                <button
                  className="btn subtle"
                  onClick={() => void navigator.clipboard?.writeText(g.pgn!).catch(() => {})}
                >
                  PGN
                </button>
              )}
              <button className="btn subtle danger-text" onClick={() => void remove(g.id)}>
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
