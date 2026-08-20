import type { GameOverState } from '../../lib/chess/types';

const REASON_TEXT: Record<string, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  threefold: 'Draw by repetition',
  'fifty-move': 'Draw by fifty-move rule',
  insufficient: 'Insufficient material',
  resign: 'Resignation',
  timeout: 'Time out',
  'timeout-insufficient': 'Time out — draw (no mating material)',
  agreement: 'Draw agreed',
  abort: 'Game aborted',
  'no-moves': 'No moves left',
  'no-pieces': 'All pieces captured',
  'no-progress': 'Draw — no progress',
  repetition: 'Draw by repetition',
};

export function GameOverDialog({
  over,
  whiteName,
  blackName,
  onRematch,
  onAnalyze,
  onClose,
  ratingChange,
  analysisProgress,
  accuracy,
  acpl,
}: {
  over: GameOverState;
  whiteName: string;
  blackName: string;
  onRematch?: () => void;
  onAnalyze?: () => void;
  onClose: () => void;
  ratingChange?: string | null;
  analysisProgress?: { done: number; total: number } | null;
  accuracy?: { w: number; b: number } | null;
  acpl?: { w: number; b: number } | null;
}) {
  if (!over.over) return null;
  const title =
    over.reason === 'abort'
      ? 'Aborted'
      : over.result === '1/2-1/2'
        ? 'Draw'
        : over.winner === 'w' || over.result === '1-0'
          ? `${whiteName} wins`
          : `${blackName} wins`;
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="dialog-sub">{REASON_TEXT[over.reason ?? ''] ?? over.reason}</p>
        {over.result && <p className="dialog-result">{over.result}</p>}
        {ratingChange && <p className="dialog-rating">{ratingChange}</p>}
        {analysisProgress && (
          <p className="dialog-analysis">
            Analyzing… {analysisProgress.done}/{analysisProgress.total}
          </p>
        )}
        {accuracy && (
          <div className="dialog-accuracy">
            <span>
              {whiteName}: <strong>{accuracy.w}%</strong> accuracy
              {acpl ? ` · ${acpl.w} avg loss` : ''}
            </span>
            <span>
              {blackName}: <strong>{accuracy.b}%</strong> accuracy
              {acpl ? ` · ${acpl.b} avg loss` : ''}
            </span>
          </div>
        )}
        <div className="dialog-actions">
          {onRematch && (
            <button className="btn primary" onClick={onRematch}>
              Rematch
            </button>
          )}
          {onAnalyze && (
            <button className="btn" onClick={onAnalyze}>
              Analyze
            </button>
          )}
          <button className="btn subtle" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
