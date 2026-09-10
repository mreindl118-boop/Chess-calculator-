import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from './types';

/**
 * Compact static exchange evaluation (SEE) and sacrifice detection.
 *
 * chess.js has no SEE, so this implements one from the board array: for any
 * move it computes the net material the moving side ends up with, assuming both
 * sides play out the best capturing sequence on the contested square (least
 * valuable attacker first, standing pat when a capture would lose). X-ray
 * attackers behind sliders are handled naturally by recomputing the least
 * valuable attacker on the post-capture board at each ply.
 *
 * "Invested material" for a move is the number of pawns the mover stands to
 * lose — either on the moved piece's own square (a losing capture or a piece
 * left en prise) or on another of the mover's pieces whose defender just left
 * (abandonment). SEE-neutral or winning exchanges invest nothing.
 */

export type Magnitude = 'spicy' | 'unhinged' | 'psychotic';

/** minimum invested pawns for each magnitude rung */
export const MAGNITUDE_MIN: Record<Magnitude, number> = {
  spicy: 3, // minor piece
  unhinged: 5, // rook
  psychotic: 9, // queen / multi-piece
};

export interface SacCandidate {
  /** canonical UCI (e2e4, d1h5, e7e8q) */
  uci: string;
  from: Square;
  to: Square;
  san: string;
  /** invested material in pawns (>= MAGNITUDE_MIN.spicy) */
  invested: number;
  /** the type of piece that moved */
  movedType: PieceSymbol;
  tier: Magnitude;
}

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 1000 };

type Cell = { t: PieceSymbol; c: Color } | null;
type Grid = Cell[][]; // grid[r][c], r=0 is rank 8, c=0 is file a

export function tierFor(invested: number): Magnitude {
  if (invested >= MAGNITUDE_MIN.psychotic) return 'psychotic';
  if (invested >= MAGNITUDE_MIN.unhinged) return 'unhinged';
  return 'spicy';
}

function fileOf(s: Square): number {
  return s.charCodeAt(0) - 97;
}
function rankRow(s: Square): number {
  return 8 - Number(s[1]);
}
function other(c: Color): Color {
  return c === 'w' ? 'b' : 'w';
}

function toGrid(board: ({ type: PieceSymbol; color: Color } | null)[][]): Grid {
  return board.map((row) => row.map((cell) => (cell ? { t: cell.type, c: cell.color } : null)));
}
function clone(g: Grid): Grid {
  return g.map((row) => row.slice());
}

const KNIGHT = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];
const DIAG = [
  [-1, -1], [-1, 1], [1, -1], [1, 1],
];
const ORTHO = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
];

const inBounds = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

/** The least-valuable piece of `side` that attacks (tr,tc) on the current grid, or null. */
function leastValuableAttacker(
  g: Grid,
  tr: number,
  tc: number,
  side: Color,
): { r: number; c: number; t: PieceSymbol } | null {
  let best: { r: number; c: number; t: PieceSymbol } | null = null;
  const consider = (r: number, c: number, t: PieceSymbol) => {
    if (!best || VALUE[t] < VALUE[best.t]) best = { r, c, t };
  };

  // pawns (a pawn on the rank "behind" the target, diagonally adjacent, attacks it)
  const pr = side === 'w' ? tr + 1 : tr - 1;
  for (const dc of [-1, 1]) {
    const c = tc + dc;
    if (inBounds(pr, c)) {
      const cell = g[pr][c];
      if (cell && cell.c === side && cell.t === 'p') consider(pr, c, 'p');
    }
  }
  // knights
  for (const [dr, dc] of KNIGHT) {
    const r = tr + dr;
    const c = tc + dc;
    if (inBounds(r, c)) {
      const cell = g[r][c];
      if (cell && cell.c === side && cell.t === 'n') consider(r, c, 'n');
    }
  }
  // king
  for (const [dr, dc] of KING) {
    const r = tr + dr;
    const c = tc + dc;
    if (inBounds(r, c)) {
      const cell = g[r][c];
      if (cell && cell.c === side && cell.t === 'k') consider(r, c, 'k');
    }
  }
  // sliding pieces along each ray (first blocker only)
  const ray = (dirs: number[][], types: PieceSymbol[]) => {
    for (const [dr, dc] of dirs) {
      let r = tr + dr;
      let c = tc + dc;
      while (inBounds(r, c)) {
        const cell = g[r][c];
        if (cell) {
          if (cell.c === side && types.includes(cell.t)) consider(r, c, cell.t);
          break;
        }
        r += dr;
        c += dc;
      }
    }
  };
  ray(DIAG, ['b', 'q']);
  ray(ORTHO, ['r', 'q']);
  return best;
}

/** SEE of `side` initiating captures on the piece currently sitting on (tr,tc). Always >= 0. */
function seeCapture(g: Grid, tr: number, tc: number, side: Color): number {
  const target = g[tr][tc];
  if (!target) return 0;
  const atk = leastValuableAttacker(g, tr, tc, side);
  if (!atk) return 0;
  const captured = VALUE[target.t];
  const ng = clone(g);
  ng[tr][tc] = { t: atk.t, c: side };
  ng[atk.r][atk.c] = null;
  const val = captured - seeCapture(ng, tr, tc, other(side));
  return Math.max(0, val);
}

interface VerboseMove {
  from: Square;
  to: Square;
  piece: PieceSymbol;
  color: Color;
  promotion?: PieceSymbol;
  captured?: PieceSymbol;
  flags: string;
  san: string;
}

/** Apply a move to a fresh grid (handles en passant + promotion), returning the new grid. */
function applyMove(g: Grid, m: VerboseMove): Grid {
  const fr = rankRow(m.from);
  const fc = fileOf(m.from);
  const tr = rankRow(m.to);
  const tc = fileOf(m.to);
  const ng = clone(g);
  const mover = ng[fr][fc];
  ng[fr][fc] = null;
  if (m.flags.includes('e')) {
    // en passant: the captured pawn sits on the mover's rank, target file
    const epr = m.color === 'w' ? tr + 1 : tr - 1;
    ng[epr][tc] = null;
  }
  ng[tr][tc] = { t: m.promotion ?? (mover ? mover.t : m.piece), c: m.color };
  return ng;
}

/** Net material (pawns) for the mover after this move, best capture sequence assumed. */
function seeMove(g: Grid, m: VerboseMove): number {
  const tr = rankRow(m.to);
  const tc = fileOf(m.to);
  let captured = 0;
  if (m.flags.includes('e')) captured = VALUE.p;
  else if (m.captured) captured = VALUE[m.captured];
  const ng = applyMove(g, m);
  return captured - seeCapture(ng, tr, tc, other(m.color));
}

/**
 * Invested material (pawns) for a move: the most the opponent can win in reply,
 * whether by capturing the moved piece (losing capture / en prise) or by
 * winning another of the mover's pieces whose defender just moved (abandonment).
 * SEE-neutral or winning moves return 0.
 */
export function moveInvestment(g: Grid, m: VerboseMove): number {
  const investedSelf = Math.max(0, -seeMove(g, m));

  // Abandonment: a piece that becomes winnable only because this move was made.
  const opp = other(m.color);
  const before = g;
  const after = applyMove(g, m);
  const tr = rankRow(m.to);
  const tc = fileOf(m.to);
  let abandon = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = after[r][c];
      if (!cell || cell.c !== m.color || cell.t === 'k') continue;
      if (r === tr && c === tc) continue; // the moved piece itself (covered by investedSelf)
      const gainAfter = seeCapture(after, r, c, opp);
      if (gainAfter <= 0) continue;
      const gainBefore = before[r][c] ? seeCapture(before, r, c, opp) : 0;
      abandon = Math.max(abandon, gainAfter - gainBefore);
    }
  }
  return Math.max(investedSelf, abandon);
}

/**
 * All legal sacrifices from `fen` for the side to move, sorted by invested
 * material descending. A move qualifies when it invests at least the Spicy rung
 * (3 pawns). Returns [] for positions chess.js can't parse (e.g. odd Chess960
 * castling strings) — the caller simply runs no hunt.
 */
export function findSacrifices(fen: string): SacCandidate[] {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return [];
  }
  const grid = toGrid(chess.board() as ({ type: PieceSymbol; color: Color } | null)[][]);
  let moves: VerboseMove[];
  try {
    moves = chess.moves({ verbose: true }) as unknown as VerboseMove[];
  } catch {
    return [];
  }
  const out: SacCandidate[] = [];
  for (const m of moves) {
    const invested = moveInvestment(grid, m);
    if (invested < MAGNITUDE_MIN.spicy) continue;
    out.push({
      uci: m.from + m.to + (m.promotion ?? ''),
      from: m.from,
      to: m.to,
      san: m.san,
      invested,
      movedType: m.piece,
      tier: tierFor(invested),
    });
  }
  out.sort((a, b) => b.invested - a.invested);
  return out;
}

/**
 * Replay a UCI principal variation on chess.js and confirm it is a real forced
 * mate delivered BY the side to move at `fen`: the final position is checkmate
 * and it was the mover who delivered it (odd-length line). Returns the mate
 * distance in moves, or null if the PV does not end in mate for the mover.
 */
export function pvMateForMover(fen: string, pv: string[]): number | null {
  if (pv.length === 0 || pv.length % 2 === 0) return null; // mover delivers on an odd ply
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  for (const uci of pv) {
    const move = {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    };
    try {
      const res = chess.move(move as { from: string; to: string; promotion?: string });
      if (!res) return null;
    } catch {
      return null;
    }
  }
  if (!chess.isCheckmate()) return null;
  return Math.ceil(pv.length / 2);
}

/** Replay a UCI PV and return its SAN moves (for display), or null if illegal. */
export function pvToSanLine(fen: string, pv: string[]): string[] | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const out: string[] = [];
  for (const uci of pv) {
    try {
      const res = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      } as { from: string; to: string; promotion?: string });
      if (!res) return null;
      out.push(res.san);
    } catch {
      return null;
    }
  }
  return out;
}

/** For tests / reuse: build a grid from a FEN. */
export function gridFromFen(fen: string): Grid | null {
  try {
    return toGrid(new Chess(fen).board() as ({ type: PieceSymbol; color: Color } | null)[][]);
  } catch {
    return null;
  }
}
