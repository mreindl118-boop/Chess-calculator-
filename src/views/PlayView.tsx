import { useEffect, useMemo, useState } from 'react';
import { ChessBoard } from '../components/board/ChessBoard';
import { PromotionPicker } from '../components/game/PromotionPicker';
import { EvalBar } from '../components/game/EvalBar';
import { EvalGraph } from '../components/game/EvalGraph';
import { MoveList } from '../components/game/MoveList';
import { ClockDisplay } from '../components/game/ClockDisplay';
import { GameOverDialog } from '../components/game/GameOverDialog';
import { useChess, currentGame } from '../state/chessStore';
import { useSettings } from '../state/settingsStore';
import { useNav } from '../state/navStore';
import { useProfiles } from '../state/profilesStore';
import type { Color } from '../lib/chess/types';

export function PlayView() {
  const chess = useChess();
  const settings = useSettings();
  const nav = useNav();
  const profiles = useProfiles();
  const [showOver, setShowOver] = useState(true);
  const [confirmResign, setConfirmResign] = useState(false);

  useEffect(() => {
    if (!chess.gameOver) {
      setShowOver(true);
      setConfirmResign(false);
    }
  }, [chess.gameOver]);

  const config = chess.config;
  const isLive = chess.viewPly === chess.history.length;

  const orientation: Color = useMemo(() => {
    if (!config) return 'w';
    if (config.mode === 'hve') return config.humanColor ?? 'w';
    if (config.mode === 'pvp' && settings.autoFlipPvP) return chess.turn;
    return 'w';
  }, [config, chess.turn, settings.autoFlipPvP]);

  const movableColor: Color | 'both' = useMemo(() => {
    if (!config) return 'both';
    if (config.mode === 'hve') return config.humanColor ?? 'w';
    if (config.mode === 'pvp') return chess.turn;
    return 'both';
  }, [config, chess.turn]);

  if (!config) {
    return (
      <div className="view-empty">
        <p>No game in progress.</p>
        <button className="btn primary" onClick={() => nav.go('home')}>
          New game
        </button>
      </div>
    );
  }

  const displayFen = isLive
    ? chess.fen
    : chess.viewPly === 0
      ? (currentGame()?.startFen ?? chess.fen)
      : chess.history[chess.viewPly - 1].fenAfter;
  const displayLast = isLive
    ? chess.lastMove
    : chess.viewPly > 0
      ? chess.history[chess.viewPly - 1]
      : null;

  const interactive = isLive && chess.status === 'playing' && config.mode !== 'eve';
  const topColor: Color = orientation === 'w' ? 'b' : 'w';
  const bottomColor: Color = orientation;

  const playerBar = (side: Color) => {
    const ref = side === 'w' ? config.white : config.black;
    let rating: number | undefined;
    if (ref.kind === 'engine') rating = ref.elo;
    else if (ref.kind === 'profile') rating = profiles.byId(ref.profileId)?.chess.rating;
    return (
      <div className={`player-bar ${chess.turn === side && isLive ? 'to-move' : ''}`}>
        <div className="player-info">
          <span className="player-name">{ref.name}</span>
          {rating !== undefined && <span className="player-rating">{rating}</span>}
          {chess.engineThinking && chess.turn === side && ref.kind === 'engine' && (
            <span className="thinking">…</span>
          )}
        </div>
        {chess.clock && (
          <ClockDisplay ms={chess.clock[side]} active={chess.turn === side && isLive} />
        )}
      </div>
    );
  };

  const ratedTag = config.rated ? 'Rated' : 'Casual';
  const showEval =
    settings.evalBar && !config.rated && (config.mode === 'eve' || config.mode === 'hve');

  return (
    <div className="play-view">
      <div className="play-header">
        <button className="btn subtle" onClick={() => nav.go('home')}>
          ‹ Home
        </button>
        <span className="game-tag">
          {ratedTag} · {config.variant}
        </span>
        {config.mode === 'eve' && (
          <div className="eve-controls">
            {chess.status === 'playing' ? (
              <button className="btn subtle" onClick={chess.pauseEve}>
                ⏸
              </button>
            ) : chess.status === 'paused' ? (
              <>
                <button className="btn subtle" onClick={chess.resumeEve}>
                  ▶
                </button>
                <button className="btn subtle" onClick={chess.stepEve}>
                  ⏭
                </button>
              </>
            ) : null}
            <button className="btn subtle" onClick={chess.abort}>
              ✕
            </button>
          </div>
        )}
      </div>

      {playerBar(topColor)}

      <div className="board-row">
        {showEval && <EvalBar cp={chess.evalCp} orientation={orientation} />}
        <div className="board-wrap" data-theme-board={settings.boardTheme}>
          <ChessBoard
            fen={displayFen}
            orientation={orientation}
            interactive={interactive}
            movableColor={movableColor}
            lastMove={displayLast ? { from: displayLast.from, to: displayLast.to } : null}
            checkSquare={isLive ? chess.checkSquare : undefined}
            premove={chess.premove}
            hint={chess.hintMove ? { from: chess.hintMove.from, to: chess.hintMove.to } : null}
            legalTargetsFor={(sq) => chess.legalTargets(sq)}
            onMove={({ from, to }) => chess.attemptMove(from, to)}
          />
          {chess.pendingPromotion && (
            <PromotionPicker
              color={chess.turn}
              onPick={chess.completePromotion}
              onCancel={chess.cancelPromotion}
            />
          )}
        </div>
      </div>

      {playerBar(bottomColor)}

      {config.mode === 'eve' && chess.evals.length > 1 && (
        <EvalGraph evals={chess.evals} currentPly={chess.viewPly} onSeek={chess.goToPly} />
      )}

      <div className="play-controls">
        <button
          className="btn subtle"
          disabled={chess.viewPly === 0}
          onClick={() => chess.goToPly(chess.viewPly - 1)}
        >
          ◀
        </button>
        <button
          className="btn subtle"
          disabled={isLive}
          onClick={() => chess.goToPly(chess.viewPly + 1)}
        >
          ▶
        </button>
        {config.mode !== 'eve' && chess.status === 'playing' && (
          <>
            {!config.rated && config.mode === 'hve' && (
              <>
                <button className="btn subtle" onClick={chess.requestHint}>
                  Hint
                </button>
                <button
                  className="btn subtle"
                  disabled={chess.history.length === 0}
                  onClick={chess.takeback}
                >
                  Takeback
                </button>
              </>
            )}
            {!config.rated && config.mode === 'pvp' && (
              <button
                className="btn subtle"
                disabled={chess.history.length === 0}
                onClick={chess.takeback}
              >
                Takeback
              </button>
            )}
            <button className="btn subtle" onClick={() => chess.offerDraw(chess.turn)}>
              ½
            </button>
            {confirmResign ? (
              <>
                <button
                  className="btn danger"
                  onClick={() => {
                    setConfirmResign(false);
                    chess.resign();
                  }}
                >
                  Confirm
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

      {chess.drawOffer && config.mode === 'pvp' && chess.status === 'playing' && (
        <div className="draw-banner">
          <span>{chess.drawOffer === 'w' ? 'White' : 'Black'} offers a draw</span>
          <button className="btn primary" onClick={() => chess.respondDraw(true)}>
            Accept
          </button>
          <button className="btn subtle" onClick={() => chess.respondDraw(false)}>
            Decline
          </button>
        </div>
      )}

      <MoveList
        history={chess.history}
        viewPly={chess.viewPly}
        onJump={chess.goToPly}
        analysis={chess.postAnalysis}
      />

      {chess.gameOver && showOver && (
        <GameOverDialog
          over={chess.gameOver}
          whiteName={config.white.name}
          blackName={config.black.name}
          analysisProgress={chess.analysisProgress}
          onAnalyze={
            chess.savedGameId
              ? () => nav.go('analysis', { gameId: chess.savedGameId! })
              : undefined
          }
          onClose={() => setShowOver(false)}
        />
      )}
      {chess.gameOver && !showOver && (
        <button className="btn floating" onClick={() => setShowOver(true)}>
          Result
        </button>
      )}
    </div>
  );
}
