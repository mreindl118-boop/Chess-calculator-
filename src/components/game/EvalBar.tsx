import { winPercent, MATE_SCORE } from '../../lib/engine/analysis';
import type { Color } from '../../lib/chess/types';

export function EvalBar({ cp, orientation }: { cp: number | null; orientation: Color }) {
  const value = cp ?? 0;
  const whitePct = winPercent(value);
  const topIsWhite = orientation === 'b';
  const whiteHeight = `${whitePct}%`;
  const label =
    Math.abs(value) >= MATE_SCORE - 100
      ? `#${MATE_SCORE - Math.abs(value)}`
      : (value / 100).toFixed(1);
  return (
    <div className={`eval-bar ${topIsWhite ? 'flipped' : ''}`} title={`eval ${label}`}>
      <div className="eval-bar-white" style={{ height: whiteHeight }} />
      <span className={`eval-bar-label ${value >= 0 ? 'on-white' : 'on-black'}`}>{label}</span>
    </div>
  );
}
