import { useEffect, useRef } from 'react';
import type { RecordedMove } from '../../lib/chess/types';
import type { GameAnalysis, MoveClass } from '../../lib/engine/analysis';

const CLASS_BADGE: Record<MoveClass, { label: string; cls: string } | null> = {
  best: null,
  excellent: null,
  good: null,
  inaccuracy: { label: '?!', cls: 'badge-inaccuracy' },
  mistake: { label: '?', cls: 'badge-mistake' },
  blunder: { label: '??', cls: 'badge-blunder' },
};

export function MoveList({
  history,
  viewPly,
  onJump,
  startPlyNumber = 1,
  firstMoveColor = 'w',
  analysis,
}: {
  history: RecordedMove[];
  viewPly: number;
  onJump: (ply: number) => void;
  startPlyNumber?: number;
  firstMoveColor?: 'w' | 'b';
  analysis?: GameAnalysis | null;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [viewPly]);

  const rows: Array<{ num: number; white?: number; black?: number }> = [];
  let idx = 0;
  let num = startPlyNumber;
  if (firstMoveColor === 'b' && history.length > 0) {
    rows.push({ num, black: 0 });
    idx = 1;
    num++;
  }
  while (idx < history.length) {
    const row: { num: number; white?: number; black?: number } = { num, white: idx };
    if (idx + 1 < history.length) row.black = idx + 1;
    rows.push(row);
    idx += 2;
    num++;
  }

  const cell = (plyIdx: number | undefined) => {
    if (plyIdx === undefined) return <span className="move-cell empty" />;
    const m = history[plyIdx];
    const active = viewPly === plyIdx + 1;
    const badge = analysis?.moves[plyIdx] ? CLASS_BADGE[analysis.moves[plyIdx].class] : null;
    return (
      <button
        ref={active ? activeRef : undefined}
        className={`move-cell ${active ? 'active' : ''}`}
        onClick={() => onJump(plyIdx + 1)}
      >
        {m.san}
        {badge && <span className={`move-badge ${badge.cls}`}>{badge.label}</span>}
      </button>
    );
  };

  return (
    <div className="move-list">
      {rows.map((r) => (
        <div key={r.num} className="move-row">
          <span className="move-num">{r.num}.</span>
          {cell(r.white)}
          {cell(r.black)}
        </div>
      ))}
    </div>
  );
}
