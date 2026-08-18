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
        <svg className="home-logo" viewBox="0 0 100 100" aria-hidden>
          <rect width="100" height="100" rx="24" fill="var(--bg-elevated)" stroke="var(--border-strong)" />
          <rect x="24" y="24" width="15" height="15" fill="#e8e4da" rx="2" />
          <rect x="39" y="24" width="15" height="15" fill="var(--accent)" rx="2" />
          <rect x="24" y="39" width="15" height="15" fill="var(--accent)" rx="2" />
          <rect x="39" y="39" width="15" height="15" fill="#e8e4da" rx="2" />
          <circle cx="66" cy="66" r="15" fill="var(--accent)" />
          <circle cx="66" cy="66" r="7" fill="none" stroke="var(--bg-elevated)" strokeWidth="2.6" />
        </svg>
        <h1>GambitLab</h1>
        <p className="tagline">Play chess &amp; checkers · analyze anything · watch yourself improve</p>
      </header>

      {(hasChessSnapshot || chess.status === 'playing') && (
        <button className="resume-card" onClick={() => void resumeChess()}>
          <span className="resume-title">Continue your chess game</span>
          <span className="resume-sub">Picked up right where you left off</span>
        </button>
      )}
      {(hasCheckersSnapshot || checkers.status === 'playing') && (
        <button className="resume-card" onClick={() => void resumeCheckers()}>
          <span className="resume-title">Continue your checkers game</span>
          <span className="resume-sub">Picked up right where you left off</span>
        </button>
      )}

      <button className="btn primary big new-game" onClick={() => setShowSheet(true)}>
        Play a game
      </button>

      <div className="home-grid">
        <button className="home-tile" onClick={() => nav.go('analysis')}>
          <svg className="tile-svg" viewBox="0 0 24 24" aria-hidden>
            <circle cx={10.5} cy={10.5} r={6.2} />
            <path d="M15.2 15.2 L20.5 20.5 M8 10.5 L13 10.5 M10.5 8 L10.5 13" />
          </svg>
          <span>Analyze</span>
        </button>
        <button className="home-tile" onClick={() => nav.go('library')}>
          <svg className="tile-svg" viewBox="0 0 24 24" aria-hidden>
            <path d="M4 5.5 Q8 3.8 12 5.5 L12 19.5 Q8 17.8 4 19.5 Z M20 5.5 Q16 3.8 12 5.5 L12 19.5 Q16 17.8 20 19.5 Z" />
          </svg>
          <span>My games</span>
        </button>
        <button className="home-tile" onClick={() => nav.go('puzzles')}>
          <svg className="tile-svg" viewBox="0 0 24 24" aria-hidden>
            <circle cx={12} cy={12} r={8.2} />
            <circle cx={12} cy={12} r={4.4} />
            <circle cx={12} cy={12} r={1} />
          </svg>
          <span>Train</span>
        </button>
        <button className="home-tile" onClick={() => nav.go('stats')}>
          <svg className="tile-svg" viewBox="0 0 24 24" aria-hidden>
            <path d="M4 20 L20 20 M6.5 20 L6.5 13 M11.2 20 L11.2 8 M15.9 20 L15.9 11 M20 20 L20 5.5" />
          </svg>
          <span>Progress</span>
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
