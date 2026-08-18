import { useEffect, useMemo, useState } from 'react';
import { ChessBoard } from '../components/board/ChessBoard';
import { db, type BlunderPuzzle } from '../lib/db/schema';
import { VariantGame } from '../lib/chess/variantGame';
import { useSettings } from '../state/settingsStore';
import { useProfiles } from '../state/profilesStore';
import { playSound } from '../lib/audio/sounds';
import type { Color, Square } from '../lib/chess/types';

export function PuzzlesView() {
  const settings = useSettings();
  const profiles = useProfiles();
  const [puzzles, setPuzzles] = useState<BlunderPuzzle[]>([]);
  const [profileFilter, setProfileFilter] = useState('');
  const [current, setCurrent] = useState<BlunderPuzzle | null>(null);
  const [state, setState] = useState<'solving' | 'solved' | 'failed'>('solving');
  const [attemptFen, setAttemptFen] = useState('');
  const [lastTry, setLastTry] = useState<{ from: Square; to: Square } | null>(null);

  const load = async () => {
    const all = await (await db()).getAll('puzzles');
    setPuzzles(all.sort((a, b) => b.createdAt - a.createdAt));
  };
  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () => puzzles.filter((p) => !profileFilter || p.profileId === profileFilter),
    [puzzles, profileFilter],
  );

  const openPuzzle = (p: BlunderPuzzle) => {
    setCurrent(p);
    setState('solving');
    setAttemptFen(p.fen);
    setLastTry(null);
  };

  const game = useMemo(() => {
    if (!current) return null;
    try {
      return new VariantGame({ variant: 'custom', fen: attemptFen });
    } catch {
      return null;
    }
  }, [current, attemptFen]);

  const turn: Color = (attemptFen.split(' ')[1] ?? 'w') as Color;

  const tryMove = async (from: Square, to: Square) => {
    if (!current || !game || state !== 'solving') return;
    const needsPromo = game.needsPromotion(from, to);
    const attempt = from + to + (needsPromo ? 'q' : '');
    const rec = game.move({ from, to, promotion: needsPromo ? 'q' : undefined });
    if (!rec) return;
    setLastTry({ from, to });
    setAttemptFen(rec.fenAfter);
    const correct = attempt === current.bestUci || rec.uci === current.bestUci;
    const d = await db();
    const stored = await d.get('puzzles', current.id);
    if (stored) {
      stored.attempts += 1;
      if (correct) stored.solved += 1;
      stored.lastResult = correct ? 'solved' : 'failed';
      await d.put('puzzles', stored);
    }
    setState(correct ? 'solved' : 'failed');
    playSound(correct ? 'gameend' : 'illegal');
    void load();
  };

  if (current) {
    return (
      <div className="puzzles-view">
        <div className="play-header">
          <button className="btn subtle" onClick={() => setCurrent(null)}>
            ‹ Puzzles
          </button>
          <span className="game-tag">Blunder redo · find the better move</span>
        </div>
        <p className="puzzle-prompt">
          {turn === 'w' ? 'White' : 'Black'} to move. You played{' '}
          <strong>{current.playedUci}</strong> here and lost{' '}
          {(current.cpLoss / 100).toFixed(1)} pawns. Find the engine move.
        </p>
        <div className="board-wrap" data-theme-board={settings.boardTheme}>
          <ChessBoard
            fen={attemptFen}
            orientation={(current.fen.split(' ')[1] ?? 'w') as Color}
            interactive={state === 'solving'}
            movableColor={(current.fen.split(' ')[1] ?? 'w') as Color}
            lastMove={lastTry}
            legalTargetsFor={(sq) => game?.moves({ square: sq }) ?? []}
            onMove={({ from, to }) => void tryMove(from, to)}
          />
        </div>
        {state === 'solved' && <p className="puzzle-result good">✓ That's the move.</p>}
        {state === 'failed' && (
          <p className="puzzle-result bad">
            ✗ The engine preferred <strong>{current.bestUci}</strong>.
          </p>
        )}
        {state !== 'solving' && (
          <div className="puzzle-actions">
            <button className="btn subtle" onClick={() => openPuzzle(current)}>
              Retry
            </button>
            <button
              className="btn primary"
              onClick={() => {
                const idx = filtered.findIndex((p) => p.id === current.id);
                const next = filtered[(idx + 1) % filtered.length];
                if (next && next.id !== current.id) openPuzzle(next);
                else setCurrent(null);
              }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="puzzles-view">
      <h2>Blunder redo</h2>
      <p className="field-hint">
        Mini-puzzles minted from your own blunders — find the move you should have played.
      </p>
      {profiles.profiles.length > 1 && (
        <select value={profileFilter} onChange={(e) => setProfileFilter(e.target.value)}>
          <option value="">All profiles</option>
          {profiles.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {filtered.length === 0 && (
        <p className="field-hint">
          Nothing here yet. Play games with a profile bound — blunders found by the post-game
          analysis become puzzles.
        </p>
      )}
      <div className="puzzle-list">
        {filtered.map((p) => (
          <button key={p.id} className="puzzle-card" onClick={() => openPuzzle(p)}>
            <span>
              −{(p.cpLoss / 100).toFixed(1)} pawns ·{' '}
              {(p.fen.split(' ')[1] === 'w' ? 'White' : 'Black') + ' to move'}
            </span>
            <span className="puzzle-status">
              {p.lastResult === 'solved' ? '✓' : p.attempts > 0 ? `${p.attempts} tries` : 'new'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
