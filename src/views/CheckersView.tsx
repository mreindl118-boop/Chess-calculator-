import { useEffect, useMemo, useState } from 'react';
import { CheckersBoard } from '../components/board/CheckersBoard';
import { ClockDisplay } from '../components/game/ClockDisplay';
import { GameOverDialog } from '../components/game/GameOverDialog';
import { useCheckers } from '../state/checkersStore';
import { useNav } from '../state/navStore';
import { useProfiles } from '../state/profilesStore';
import { useSettings } from '../state/settingsStore';
import type { CheckersColor } from '../lib/checkers/rules';

export function CheckersView() {
  const g = useCheckers();
  const nav = useNav();
  const profiles = useProfiles();
  const settings = useSettings();
  const [showOver, setShowOver] = useState(true);
  const [confirmResign, setConfirmResign] = useState(false);

  useEffect(() => {
    if (!g.gameOver) {
      setShowOver(true);
      setConfirmResign(false);
    }
  }, [g.gameOver]);

  const config = g.config;

  const orientation: CheckersColor = useMemo(() => {
    if (!config) return 'w';
    if (config.mode === 'hva') return config.humanColor ?? 'w';
    if (config.mode === 'pvp' && settings.autoFlipPvP) return g.turn;
    return 'w';
  }, [config, g.turn, settings.autoFlipPvP]);

  if (!config) {
    return (
      <div className="view-empty">
        <p>No checkers game in progress.</p>
        <button className="btn primary" onClick={() => nav.go('home')}>
          New game
        </button>
      </div>
    );
  }

  const movableColor: CheckersColor | 'both' =
    config.mode === 'hva' ? (config.humanColor ?? 'w') : config.mode === 'pvp' ? g.turn : 'both';

  const playerBar = (side: CheckersColor) => {
    const ref = side === 'w' ? config.white : config.black;
    let rating: number | undefined;
    if (ref.kind === 'checkers-ai') rating = ref.rating;
    else if (ref.kind === 'profile') rating = profiles.byId(ref.profileId)?.checkers.rating;
    return (
      <div className={`player-bar ${g.turn === side ? 'to-move' : ''}`}>
        <div className="player-info">
          <span className="player-name">{ref.name}</span>
          {rating !== undefined && <span className="player-rating">{rating}</span>}
          {g.aiThinking && g.turn === side && ref.kind === 'checkers-ai' && (
            <span className="thinking">…</span>
          )}
        </div>
        {g.clock && <ClockDisplay ms={g.clock[side]} active={g.turn === side} />}
      </div>
    );
  };

  const topColor: CheckersColor = orientation === 'w' ? 'b' : 'w';

  return (
    <div className="play-view">
      <div className="play-header">
        <button className="btn subtle" onClick={() => nav.go('home')}>
          ‹ Home
        </button>
        <span className="game-tag">
          {config.rated ? 'Rated' : 'Casual'} · checkers
          {!config.rules.forcedCapture && ' · free capture'}
          {config.rules.flyingKings && ' · flying kings'}
        </span>
        {config.mode === 'ava' && (
          <div className="eve-controls">
            {g.status === 'playing' ? (
              <button className="btn subtle" onClick={g.pauseAva}>
                ⏸
              </button>
            ) : g.status === 'paused' ? (
              <button className="btn subtle" onClick={g.resumeAva}>
                ▶
              </button>
            ) : null}
            <button className="btn subtle" onClick={g.abort}>
              ✕
            </button>
          </div>
        )}
      </div>

      {playerBar(topColor)}

      <div className="board-row">
        <div className="board-wrap" data-theme-board={settings.boardTheme}>
          <CheckersBoard
            board={g.board}
            orientation={orientation}
            selected={g.selected}
            legal={g.legal}
            lastMove={g.lastMove}
            interactive={g.status === 'playing' && config.mode !== 'ava'}
            movableColor={movableColor}
            onSelect={g.select}
            onMove={g.tryMove}
          />
        </div>
      </div>

      {playerBar(orientation)}

      <div className="play-controls">
        {g.status === 'playing' && config.mode !== 'ava' && (
          <>
            {confirmResign ? (
              <>
                <button
                  className="btn danger"
                  onClick={() => {
                    setConfirmResign(false);
                    g.resign();
                  }}
                >
                  Confirm resign
                </button>
                <button className="btn subtle" onClick={() => setConfirmResign(false)}>
                  Keep playing
                </button>
              </>
            ) : (
              <button className="btn subtle" onClick={() => setConfirmResign(true)}>
                Resign
              </button>
            )}
          </>
        )}
      </div>

      <div className="move-log">
        {g.moveLog.map((m, i) => (
          <span key={i} className="move-log-item">
            {i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}
            {m}
          </span>
        ))}
      </div>

      {g.gameOver && showOver && (
        <GameOverDialog
          over={{
            over: true,
            result:
              g.gameOver.reason === 'abort'
                ? undefined
                : g.gameOver.draw
                  ? '1/2-1/2'
                  : g.gameOver.winner === 'w'
                    ? '1-0'
                    : '0-1',
            reason: g.gameOver.reason as never,
            winner: g.gameOver.winner as never,
          }}
          whiteName={config.white.name}
          blackName={config.black.name}
          onClose={() => setShowOver(false)}
        />
      )}
    </div>
  );
}
