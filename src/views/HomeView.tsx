import { useEffect, useState } from 'react';
import { NewGameSheet, type NewGameRequest } from '../components/game/NewGameSheet';
import { useChess } from '../state/chessStore';
import { useCheckers } from '../state/checkersStore';
import { useNav } from '../state/navStore';
import { useProfiles, AVATAR_COLORS } from '../state/profilesStore';
import { kvGet } from '../lib/db/schema';

export function HomeView() {
  const nav = useNav();
  const chess = useChess();
  const checkers = useCheckers();
  const profiles = useProfiles();
  const [showSheet, setShowSheet] = useState(false);
  const [hasChessSnapshot, setHasChessSnapshot] = useState(false);
  const [hasCheckersSnapshot, setHasCheckersSnapshot] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [showProfileForm, setShowProfileForm] = useState(false);

  useEffect(() => {
    void kvGet('activeChessGame').then((s) => setHasChessSnapshot(!!s));
    void kvGet('activeCheckersGame').then((s) => setHasCheckersSnapshot(!!s));
  }, [chess.status, checkers.status]);

  const start = (req: NewGameRequest) => {
    setShowSheet(false);
    if (req.game === 'chess') {
      chess.newGame(req.config);
      nav.go('play');
    } else {
      checkers.newGame(req.config);
      nav.go('checkers');
    }
  };

  const resumeChess = async () => {
    if (chess.status === 'playing' || (await chess.resume())) nav.go('play');
  };
  const resumeCheckers = async () => {
    if (checkers.status === 'playing' || (await checkers.resume())) nav.go('checkers');
  };

  return (
    <div className="home-view">
      <header className="home-header">
        <h1>GambitLab</h1>
        <p className="tagline">Chess &amp; checkers laboratory</p>
      </header>

      {(hasChessSnapshot || chess.status === 'playing') && (
        <button className="resume-card" onClick={() => void resumeChess()}>
          <span className="resume-title">▶ Resume chess game</span>
          <span className="resume-sub">Your interrupted game is saved</span>
        </button>
      )}
      {(hasCheckersSnapshot || checkers.status === 'playing') && (
        <button className="resume-card" onClick={() => void resumeCheckers()}>
          <span className="resume-title">▶ Resume checkers game</span>
        </button>
      )}

      <button className="btn primary big new-game" onClick={() => setShowSheet(true)}>
        + New game
      </button>

      <div className="home-grid">
        <button className="home-tile" onClick={() => nav.go('analysis')}>
          <span className="tile-icon">🧪</span>
          <span>Analysis Lab</span>
        </button>
        <button className="home-tile" onClick={() => nav.go('library')}>
          <span className="tile-icon">📚</span>
          <span>Game library</span>
        </button>
        <button className="home-tile" onClick={() => nav.go('puzzles')}>
          <span className="tile-icon">🎯</span>
          <span>Blunder redo</span>
        </button>
        <button className="home-tile" onClick={() => nav.go('stats')}>
          <span className="tile-icon">📈</span>
          <span>Stats</span>
        </button>
      </div>

      <section className="home-profiles">
        <h3>Profiles</h3>
        {profiles.profiles.length === 0 && (
          <p className="field-hint">Create a profile to play rated games and track your Elo.</p>
        )}
        <div className="profile-list">
          {profiles.profiles.map((p) => (
            <div key={p.id} className="profile-chip">
              <span className="avatar" style={{ background: p.avatarColor }}>
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="profile-name">{p.name}</span>
              <span className="profile-ratings">
                ♞ {p.chess.rating} · ⛀ {p.checkers.rating}
              </span>
            </div>
          ))}
          {showProfileForm ? (
            <form
              className="profile-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (newProfileName.trim()) {
                  void profiles.create(
                    newProfileName.trim(),
                    AVATAR_COLORS[profiles.profiles.length % AVATAR_COLORS.length],
                  );
                  setNewProfileName('');
                  setShowProfileForm(false);
                }
              }}
            >
              <input
                autoFocus
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="Name"
                maxLength={20}
              />
              <button className="btn primary" type="submit">
                Add
              </button>
            </form>
          ) : (
            <button className="btn subtle" onClick={() => setShowProfileForm(true)}>
              + Add profile
            </button>
          )}
        </div>
      </section>

      {showSheet && <NewGameSheet onStart={start} onClose={() => setShowSheet(false)} />}
    </div>
  );
}
