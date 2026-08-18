import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Color, PieceSymbol, Square, UiMove } from '../../lib/chess/types';
import { fileOf, rankOf, squareOf, FILES } from '../../lib/chess/types';
import { PieceGlyph } from './pieces';
import { useSettings } from '../../state/settingsStore';

export interface BoardMoveIntent {
  from: Square;
  to: Square;
}

export interface ChessBoardProps {
  fen: string;
  orientation: Color;
  interactive: boolean;
  /** which side's pieces may be picked up ('both' for PvP/editor) */
  movableColor?: Color | 'both';
  lastMove?: { from: Square; to: Square } | null;
  checkSquare?: Square | null;
  premove?: { from: Square; to: Square } | null;
  hint?: { from: Square; to: Square } | null;
  arrow?: { from: Square; to: Square } | null;
  /** ranked suggestion arrows (0 = best); rendered under `arrow`/`hint` */
  arrows?: Array<{ from: Square; to: Square; rank: number }>;
  legalTargetsFor?: (from: Square) => UiMove[];
  onMove?: (intent: BoardMoveIntent) => void;
  /** editor mode: report raw drops anywhere incl. off-board */
  onEditorDrop?: (from: Square, to: Square | null) => void;
  /** editor palette: return true to consume the tap (e.g. piece placed) */
  onSquareTap?: (sq: Square) => boolean;
}

interface TrackedPiece {
  id: number;
  square: Square;
  type: PieceSymbol;
  color: Color;
}

let nextPieceId = 1;

function parseFenPieces(fen: string): Array<{ square: Square; type: PieceSymbol; color: Color }> {
  const rows = fen.split(' ')[0].split('/');
  const out: Array<{ square: Square; type: PieceSymbol; color: Color }> = [];
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        f += parseInt(ch, 10);
      } else {
        out.push({
          square: squareOf(f, 7 - r),
          type: ch.toLowerCase() as PieceSymbol,
          color: ch === ch.toUpperCase() ? 'w' : 'b',
        });
        f++;
      }
    }
  }
  return out;
}

/**
 * Assign stable ids across position changes so pieces animate (CSS transform
 * transitions) instead of teleporting. The moved piece keeps its id via the
 * lastMove hint; everything else matches by square.
 */
function trackPieces(
  prev: TrackedPiece[],
  fen: string,
  lastMove?: { from: Square; to: Square } | null,
): TrackedPiece[] {
  const next = parseFenPieces(fen);
  const prevBySquare = new Map(prev.map((p) => [p.square, p]));
  const used = new Set<number>();
  const out: TrackedPiece[] = [];
  const unmatched: Array<{ square: Square; type: PieceSymbol; color: Color }> = [];

  for (const n of next) {
    const same = prevBySquare.get(n.square);
    if (same && same.type === n.type && same.color === n.color && !used.has(same.id)) {
      used.add(same.id);
      out.push({ ...same });
    } else {
      unmatched.push(n);
    }
  }
  for (const n of unmatched) {
    let claimed: TrackedPiece | undefined;
    if (lastMove && n.square === lastMove.to) {
      const moved = prevBySquare.get(lastMove.from);
      if (moved && moved.color === n.color && !used.has(moved.id)) claimed = moved;
    }
    if (!claimed) {
      // castling rook / en-passant style secondary movement: match nearest same piece
      claimed = prev.find(
        (p) => !used.has(p.id) && p.type === n.type && p.color === n.color &&
          !next.some((x) => x.square === p.square && x.type === p.type && x.color === p.color),
      );
    }
    if (claimed) {
      used.add(claimed.id);
      out.push({ id: claimed.id, square: n.square, type: n.type, color: n.color });
    } else {
      out.push({ id: nextPieceId++, square: n.square, type: n.type, color: n.color });
    }
  }
  return out;
}

export const ChessBoard = memo(function ChessBoard(props: ChessBoardProps) {
  const {
    fen, orientation, interactive, movableColor = 'both',
    lastMove, checkSquare, premove, hint, arrow, arrows,
    legalTargetsFor, onMove, onEditorDrop, onSquareTap,
  } = props;
  const settings = useSettings();

  const [pieces, setPieces] = useState<TrackedPiece[]>(() => trackPieces([], fen));
  const piecesRef = useRef(pieces);
  useEffect(() => {
    const next = trackPieces(piecesRef.current, fen, lastMove);
    piecesRef.current = next;
    setPieces(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);

  const [selected, setSelected] = useState<Square | null>(null);
  const [dragging, setDragging] = useState<{ id: number; from: Square } | null>(null);
  const dragNode = useRef<SVGGElement | null>(null);
  const dragState = useRef<{ from: Square; pointerId: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const legalTargets = useMemo(() => {
    if (!selected || !legalTargetsFor) return [];
    return legalTargetsFor(selected);
  }, [selected, legalTargetsFor, fen]); // eslint-disable-line react-hooks/exhaustive-deps

  const toXY = useCallback(
    (sq: Square): [number, number] => {
      const f = fileOf(sq);
      const r = rankOf(sq);
      return orientation === 'w' ? [f, 7 - r] : [7 - f, r];
    },
    [orientation],
  );

  const squareAtPoint = useCallback(
    (clientX: number, clientY: number): Square | null => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return null;
      const x = ((clientX - rect.left) / rect.width) * 8;
      const y = ((clientY - rect.top) / rect.height) * 8;
      if (x < 0 || x >= 8 || y < 0 || y >= 8) return null;
      const bx = Math.floor(x);
      const by = Math.floor(y);
      const f = orientation === 'w' ? bx : 7 - bx;
      const r = orientation === 'w' ? 7 - by : by;
      return squareOf(f, r);
    },
    [orientation],
  );

  const applyDragTransform = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const node = dragNode.current;
    if (!rect || !node) return;
    const x = ((clientX - rect.left) / rect.width) * 8 - 0.5;
    const y = ((clientY - rect.top) / rect.height) * 8 - 0.5;
    node.setAttribute('transform', `translate(${x} ${y})`);
  }, []);

  const endDrag = useCallback(() => {
    dragState.current = null;
    setDragging(null);
  }, []);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (!interactive) return;
      const sq = squareAtPoint(e.clientX, e.clientY);
      if (!sq) return;
      if (onSquareTap && onSquareTap(sq)) {
        setSelected(null);
        return;
      }
      const piece = piecesRef.current.find((p) => p.square === sq);

      if (selected && (!piece || piece.square !== selected)) {
        // second tap: try the move
        const isOwn = piece && (movableColor === 'both' || piece.color === movableColor);
        if (!isOwn) {
          if (onEditorDrop) onEditorDrop(selected, sq);
          else onMove?.({ from: selected, to: sq });
          setSelected(null);
          return;
        }
      }

      if (piece && (movableColor === 'both' || piece.color === movableColor)) {
        setSelected(sq);
        dragState.current = { from: sq, pointerId: e.pointerId, moved: false };
        setDragging({ id: piece.id, from: sq });
        svgRef.current?.setPointerCapture(e.pointerId);
        // position immediately under the finger/cursor
        requestAnimationFrame(() => applyDragTransform(e.clientX, e.clientY));
      } else {
        setSelected(null);
      }
    },
    [interactive, selected, movableColor, squareAtPoint, onMove, onEditorDrop, onSquareTap, applyDragTransform],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const ds = dragState.current;
      if (!ds || e.pointerId !== ds.pointerId) return;
      ds.moved = true;
      applyDragTransform(e.clientX, e.clientY);
    },
    [applyDragTransform],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const ds = dragState.current;
      if (!ds || e.pointerId !== ds.pointerId) return;
      const target = squareAtPoint(e.clientX, e.clientY);
      const from = ds.from;
      const wasDrag = ds.moved && target !== from;
      endDrag();
      if (onEditorDrop) {
        if (target !== from) {
          onEditorDrop(from, target);
          setSelected(null);
        }
        return;
      }
      if (wasDrag) {
        setSelected(null);
        if (target) onMove?.({ from, to: target });
      }
      // otherwise: keep the selection (tap-tap flow continues)
    },
    [squareAtPoint, endDrag, onMove, onEditorDrop],
  );

  const handlePointerCancel = useCallback(() => endDrag(), [endDrag]);

  // Board theme colors come from CSS custom properties on the wrapper.
  const cells = useMemo(() => {
    const rects = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const dark = (x + y) % 2 === 1;
        rects.push(
          <rect
            key={`${x}-${y}`}
            x={x}
            y={y}
            width={1}
            height={1}
            className={dark ? 'sq-dark' : 'sq-light'}
          />,
        );
      }
    }
    return rects;
  }, []);

  const coords = useMemo(() => {
    if (!settings.coordinates) return null;
    const items = [];
    for (let i = 0; i < 8; i++) {
      const file = orientation === 'w' ? FILES[i] : FILES[7 - i];
      const rank = orientation === 'w' ? String(8 - i) : String(i + 1);
      items.push(
        <text key={`f${i}`} x={i + 0.94} y={7.94} className="coord" textAnchor="end">
          {file}
        </text>,
        <text key={`r${i}`} x={0.06} y={i + 0.22} className="coord">
          {rank}
        </text>,
      );
    }
    return items;
  }, [orientation, settings.coordinates]);

  const highlight = (sq: Square, cls: string, key?: string) => {
    const [x, y] = toXY(sq);
    return <rect key={key ?? `${cls}-${sq}`} x={x} y={y} width={1} height={1} className={cls} />;
  };

  const renderArrow = (a: { from: Square; to: Square }, cls: string, key?: string) => {
    const [x1, y1] = toXY(a.from);
    const [x2, y2] = toXY(a.to);
    return (
      <line
        key={key}
        x1={x1 + 0.5}
        y1={y1 + 0.5}
        x2={x2 + 0.5}
        y2={y2 + 0.5}
        className={cls}
        markerEnd={`url(#arrowhead-${cls})`}
      />
    );
  };

  const occupied = useMemo(() => new Set(pieces.map((p) => p.square)), [pieces]);

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 8 8"
      className="chess-board"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <defs>
        <marker
          id="arrowhead-arrow-hint"
          markerWidth={4}
          markerHeight={4}
          refX={2.4}
          refY={2}
          orient="auto"
        >
          <path d="M0,0.6 L3,2 L0,3.4 Z" className="arrow-hint-head" />
        </marker>
        <marker
          id="arrowhead-arrow-best"
          markerWidth={4}
          markerHeight={4}
          refX={2.4}
          refY={2}
          orient="auto"
        >
          <path d="M0,0.6 L3,2 L0,3.4 Z" className="arrow-best-head" />
        </marker>
        {[0, 1, 2].map((r) => (
          <marker
            key={r}
            id={`arrowhead-arrow-rank${r}`}
            markerWidth={4}
            markerHeight={4}
            refX={2.4}
            refY={2}
            orient="auto"
          >
            <path d="M0,0.6 L3,2 L0,3.4 Z" className={`arrow-rank${r}-head`} />
          </marker>
        ))}
      </defs>

      <g>{cells}</g>
      {lastMove && highlight(lastMove.from, 'hl-last')}
      {lastMove && highlight(lastMove.to, 'hl-last')}
      {checkSquare && highlight(checkSquare, 'hl-check')}
      {premove && highlight(premove.from, 'hl-premove')}
      {premove && highlight(premove.to, 'hl-premove')}
      {selected && highlight(selected, 'hl-selected')}
      {coords}

      {/* legal move dots */}
      {settings.legalDots &&
        selected &&
        legalTargets.map((m) => {
          const [x, y] = toXY(m.to);
          return occupied.has(m.to) ? (
            <circle
              key={`dot-${m.to}`}
              cx={x + 0.5}
              cy={y + 0.5}
              r={0.46}
              className="dot-capture"
            />
          ) : (
            <circle key={`dot-${m.to}`} cx={x + 0.5} cy={y + 0.5} r={0.14} className="dot-move" />
          );
        })}

      {/* pieces */}
      <g>
        {pieces.map((p) => {
          const [x, y] = toXY(p.square);
          const isDragging = dragging?.id === p.id;
          return (
            <g
              key={p.id}
              ref={isDragging ? dragNode : undefined}
              className={isDragging ? 'piece dragging' : 'piece'}
              transform={`translate(${x} ${y})`}
            >
              <g transform="scale(0.01)">
                <PieceGlyph type={p.type} color={p.color} style={settings.pieceStyle} />
              </g>
            </g>
          );
        })}
      </g>

      {arrows &&
        [...arrows]
          .sort((a, b) => b.rank - a.rank) // draw the best arrow last (on top)
          .map((a) =>
            renderArrow(a, `arrow-rank${Math.min(2, a.rank)}`, `rk${a.rank}-${a.from}${a.to}`),
          )}
      {hint && renderArrow(hint, 'arrow-hint')}
      {arrow && renderArrow(arrow, 'arrow-best')}
    </svg>
  );
});
