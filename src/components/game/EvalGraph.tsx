import { useMemo } from 'react';
import { winPercent } from '../../lib/engine/analysis';

/**
 * Eval sparkline: x = ply, y = white win% mapped 0..100 (top = white winning).
 * Pure SVG, cheap enough to re-render every move.
 */
export function EvalGraph({
  evals,
  currentPly,
  onSeek,
  height = 64,
}: {
  evals: number[];
  currentPly?: number;
  onSeek?: (ply: number) => void;
  height?: number;
}) {
  const w = 100;
  const path = useMemo(() => {
    if (evals.length === 0) return '';
    const step = evals.length > 1 ? w / (evals.length - 1) : w;
    const pts = evals.map((cp, i) => {
      const y = 100 - winPercent(cp);
      return `${(i * step).toFixed(2)},${y.toFixed(2)}`;
    });
    return `M${pts.join(' L')}`;
  }, [evals]);

  const fillPath = path ? `${path} L100,100 L0,100 Z` : '';
  const cursorX =
    currentPly !== undefined && evals.length > 1
      ? Math.min(100, (currentPly / (evals.length - 1)) * w)
      : null;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="eval-graph"
      style={{ height }}
      onClick={(e) => {
        if (!onSeek || evals.length < 2) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const frac = (e.clientX - rect.left) / rect.width;
        onSeek(Math.round(frac * (evals.length - 1)));
      }}
    >
      <rect x={0} y={0} width={100} height={100} className="eval-graph-bg" />
      <line x1={0} y1={50} x2={100} y2={50} className="eval-graph-mid" />
      {fillPath && <path d={fillPath} className="eval-graph-fill" />}
      {path && <path d={path} className="eval-graph-line" fill="none" />}
      {cursorX !== null && (
        <line x1={cursorX} y1={0} x2={cursorX} y2={100} className="eval-graph-cursor" />
      )}
    </svg>
  );
}
