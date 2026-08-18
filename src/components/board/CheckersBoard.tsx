import { memo, useMemo } from 'react';
import { colOf, rowOf, WK, BK, type CheckersMove } from '../../lib/checkers/rules';
import type { CheckersColor } from '../../lib/checkers/rules';

export interface CheckersBoardProps {
  board: number[];
  orientation: CheckersColor;
  selected: number | null;
  legal: CheckersMove[];
  lastMove: CheckersMove | null;
  interactive: boolean;
  movableColor: CheckersColor | 'both';
  onSelect: (sq: number | null) => void;
  onMove: (from: number, to: number) => void;
}

export const CheckersBoard = memo(function CheckersBoard(props: CheckersBoardProps) {
  const {
    board, orientation, selected, legal, lastMove,
    interactive, movableColor, onSelect, onMove,
  } = props;

  const toXY = (sq: number): [number, number] => {
    const r = rowOf(sq);
    const c = colOf(sq);
    // row 0 is black's back rank (top when white orientation)
    return orientation === 'w' ? [c, r] : [7 - c, 7 - r];
  };

  const targets = useMemo(
    () => (selected !== null ? legal.filter((m) => m.from === selected) : []),
    [selected, legal],
  );

  const lastSquares = useMemo(() => {
    if (!lastMove) return new Set<number>();
    return new Set([lastMove.from, ...lastMove.path]);
  }, [lastMove]);

  const handleCell = (sq: number) => {
    if (!interactive) return;
    const piece = board[sq];
    const own =
      piece !== 0 &&
      (movableColor === 'both' || (piece > 0 ? 'w' : 'b') === movableColor);
    if (selected !== null && targets.some((m) => m.to === sq)) {
      onMove(selected, sq);
      return;
    }
    if (own) {
      onSelect(sq === selected ? null : sq);
    } else {
      onSelect(null);
    }
  };

  const cells = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      cells.push(
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={1}
          height={1}
          className={(x + y) % 2 === 1 ? 'sq-dark' : 'sq-light'}
        />,
      );
    }
  }

  return (
    <svg
      viewBox="0 0 8 8"
      className="chess-board checkers-board"
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = Math.floor(((e.clientX - rect.left) / rect.width) * 8);
        const y = Math.floor(((e.clientY - rect.top) / rect.height) * 8);
        if (x < 0 || x > 7 || y < 0 || y > 7) return;
        const bx = orientation === 'w' ? x : 7 - x;
        const by = orientation === 'w' ? y : 7 - y;
        if ((bx + by) % 2 === 0) {
          onSelect(null);
          return;
        }
        const sq = by * 4 + (bx >> 1);
        handleCell(sq);
      }}
    >
      <g>{cells}</g>
      {[...lastSquares].map((sq) => {
        const [x, y] = toXY(sq);
        return <rect key={`l${sq}`} x={x} y={y} width={1} height={1} className="hl-last" />;
      })}
      {selected !== null &&
        (() => {
          const [x, y] = toXY(selected);
          return <rect x={x} y={y} width={1} height={1} className="hl-selected" />;
        })()}
      {targets.map((m) => {
        const [x, y] = toXY(m.to);
        return (
          <circle key={`t${m.to}-${m.captures.join('.')}`} cx={x + 0.5} cy={y + 0.5} r={0.15} className="dot-move" />
        );
      })}
      <g>
        {board.map((p, sq) => {
          if (p === 0) return null;
          const [x, y] = toXY(sq);
          const white = p > 0;
          const king = p === WK || p === BK;
          return (
            <g key={sq} className="piece" transform={`translate(${x} ${y})`}>
              <circle
                cx={0.5}
                cy={0.5}
                r={0.38}
                className={white ? 'checker-white' : 'checker-black'}
              />
              <circle
                cx={0.5}
                cy={0.5}
                r={0.28}
                fill="none"
                className={white ? 'checker-ring-white' : 'checker-ring-black'}
              />
              {king && (
                <text x={0.5} y={0.54} textAnchor="middle" dominantBaseline="central" className={white ? 'checker-crown-white' : 'checker-crown-black'} fontSize={0.36}>
                  ♛
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
});
