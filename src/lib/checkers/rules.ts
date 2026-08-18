/**
 * American (English) 8x8 draughts on the 32 dark squares.
 *
 * Board: Int8Array(32). Index i -> row r = i >> 2 (row 0 = top, Black's back
 * rank), column c = 2*(i%4) + ((r+1) % 2). Black men move down (+row), White
 * men move up (-row). White pieces are positive, Black negative:
 *   +1 white man, +2 white king, -1 black man, -2 black king, 0 empty.
 *
 * Rules implemented: forced captures (toggleable), mandatory multi-jump
 * continuation, crowning (which ends a jump sequence), optional flying kings.
 */

export type CheckersColor = 'w' | 'b';
export type Board = Int8Array;

export const WM = 1;
export const WK = 2;
export const BM = -1;
export const BK = -2;

export interface CheckersRules {
  forcedCapture: boolean;
  flyingKings: boolean;
}
export const DEFAULT_RULES: CheckersRules = { forcedCapture: true, flyingKings: false };

export interface CheckersMove {
  from: number;
  to: number;
  /** every square visited after `from` (single-step moves have one entry) */
  path: number[];
  /** squares of captured pieces, in capture order */
  captures: number[];
  /** the moving piece is crowned by this move */
  crowned: boolean;
}

export function rowOf(i: number): number {
  return i >> 2;
}
export function colOf(i: number): number {
  const r = i >> 2;
  return 2 * (i % 4) + ((r + 1) % 2);
}
export function squareIndex(row: number, col: number): number {
  if (row < 0 || row > 7 || col < 0 || col > 7) return -1;
  if ((row + col) % 2 === 0) return -1; // light square
  return row * 4 + (col >> 1);
}

/** [dRow, dCol] for the four diagonal directions. */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/** neighbor[i][d] = adjacent dark square in direction d, or -1 */
const NEIGHBOR: number[][] = [];
/** jump[i][d] = square two steps away in direction d, or -1 */
const JUMP: number[][] = [];
for (let i = 0; i < 32; i++) {
  const r = rowOf(i);
  const c = colOf(i);
  NEIGHBOR.push(DIRS.map(([dr, dc]) => squareIndex(r + dr, c + dc)));
  JUMP.push(DIRS.map(([dr, dc]) => squareIndex(r + 2 * dr, c + 2 * dc)));
}

export function initialBoard(): Board {
  const b = new Int8Array(32);
  for (let i = 0; i < 12; i++) b[i] = BM;
  for (let i = 20; i < 32; i++) b[i] = WM;
  return b;
}

export function colorOf(piece: number): CheckersColor | null {
  if (piece > 0) return 'w';
  if (piece < 0) return 'b';
  return null;
}
export function isKing(piece: number): boolean {
  return piece === WK || piece === BK;
}
export function crownRow(color: CheckersColor): number {
  return color === 'w' ? 0 : 7;
}

/** directions a piece may MOVE in (kings all 4; men forward only) */
function moveDirs(piece: number): number[] {
  if (isKing(piece)) return [0, 1, 2, 3];
  return piece > 0 ? [0, 1] : [2, 3]; // white up, black down
}

/**
 * In English draughts men capture only forward; kings capture all directions.
 */
function captureDirs(piece: number): number[] {
  return moveDirs(piece);
}

function findJumpsFrom(
  board: Board,
  i: number,
  piece: number,
  rules: CheckersRules,
  visited: number[],
  pathSoFar: number[],
  out: CheckersMove[],
  origin: number,
): void {
  const color = colorOf(piece)!;

  if (rules.flyingKings && isKing(piece)) {
    for (const d of [0, 1, 2, 3]) {
      // Slide until the first occupied square.
      let cur = i;
      let enemyAt = -1;
      while (true) {
        const next = NEIGHBOR[cur][d];
        if (next === -1) break;
        const occ = next === origin ? 0 : board[next]; // origin square is vacated
        if (occ === 0) {
          cur = next;
          continue;
        }
        // Already-captured pieces stay on the board mid-sequence and block.
        if (colorOf(occ) !== color && !visited.includes(next)) enemyAt = next;
        break;
      }
      if (enemyAt === -1) continue;
      // Land on any empty square beyond the captured piece.
      let land = NEIGHBOR[enemyAt][d];
      while (land !== -1 && (land === origin ? true : board[land] === 0)) {
        const newVisited = [...visited, enemyAt];
        const newPath = [...pathSoFar, land];
        const before = out.length;
        findJumpsFrom(board, land, piece, rules, newVisited, newPath, out, origin);
        if (out.length === before) {
          out.push({
            from: origin,
            to: land,
            path: newPath,
            captures: newVisited.slice(1),
            crowned: !isKing(piece) && rowOf(land) === crownRow(color),
          });
        }
        land = NEIGHBOR[land][d];
      }
    }
  } else {
    for (const d of captureDirs(piece)) {
      const over = NEIGHBOR[i][d];
      const land = JUMP[i][d];
      if (over === -1 || land === -1) continue;
      const overPiece = board[over];
      if (overPiece === 0 || colorOf(overPiece) === color) continue;
      if (visited.includes(over)) continue; // can't jump the same piece twice
      const landOcc = land === origin ? 0 : board[land];
      if (landOcc !== 0) continue;

      const newVisited = [...visited, over];
      const newPath = [...pathSoFar, land];
      const crowningNow = !isKing(piece) && rowOf(land) === crownRow(color);

      if (crowningNow) {
        // A man crowned mid-jump stops immediately.
        out.push({
          from: origin,
          to: land,
          path: newPath,
          captures: newVisited.slice(1),
          crowned: true,
        });
        continue;
      }
      const before = out.length;
      findJumpsFrom(board, land, piece, rules, newVisited, newPath, out, origin);
      if (out.length === before) {
        out.push({
          from: origin,
          to: land,
          path: newPath,
          captures: newVisited.slice(1),
          crowned: false,
        });
      }
    }
  }
}

export function captureMoves(
  board: Board,
  color: CheckersColor,
  rules: CheckersRules = DEFAULT_RULES,
): CheckersMove[] {
  const out: CheckersMove[] = [];
  for (let i = 0; i < 32; i++) {
    const piece = board[i];
    if (piece === 0 || colorOf(piece) !== color) continue;
    findJumpsFrom(board, i, piece, rules, [i], [], out, i);
  }
  return out;
}

export function quietMoves(
  board: Board,
  color: CheckersColor,
  rules: CheckersRules = DEFAULT_RULES,
): CheckersMove[] {
  const out: CheckersMove[] = [];
  for (let i = 0; i < 32; i++) {
    const piece = board[i];
    if (piece === 0 || colorOf(piece) !== color) continue;
    if (rules.flyingKings && isKing(piece)) {
      for (const d of [0, 1, 2, 3]) {
        let cur = NEIGHBOR[i][d];
        while (cur !== -1 && board[cur] === 0) {
          out.push({ from: i, to: cur, path: [cur], captures: [], crowned: false });
          cur = NEIGHBOR[cur][d];
        }
      }
    } else {
      for (const d of moveDirs(piece)) {
        const to = NEIGHBOR[i][d];
        if (to !== -1 && board[to] === 0) {
          out.push({
            from: i,
            to,
            path: [to],
            captures: [],
            crowned: !isKing(piece) && rowOf(to) === crownRow(colorOf(piece)!),
          });
        }
      }
    }
  }
  return out;
}

export function legalMoves(
  board: Board,
  color: CheckersColor,
  rules: CheckersRules = DEFAULT_RULES,
): CheckersMove[] {
  const caps = captureMoves(board, color, rules);
  if (caps.length > 0 && rules.forcedCapture) return caps;
  return [...caps, ...quietMoves(board, color, rules)];
}

/** Apply a move to a copy of the board and return it. */
export function applyMove(board: Board, move: CheckersMove): Board {
  const b = new Int8Array(board);
  const piece = b[move.from];
  b[move.from] = 0;
  for (const c of move.captures) b[c] = 0;
  const color = colorOf(piece)!;
  const landsOnCrown = rowOf(move.to) === crownRow(color);
  b[move.to] = !isKing(piece) && (move.crowned || landsOnCrown) ? (piece > 0 ? WK : BK) : piece;
  return b;
}

export function opponent(color: CheckersColor): CheckersColor {
  return color === 'w' ? 'b' : 'w';
}

export interface CheckersGameOver {
  over: boolean;
  winner?: CheckersColor;
  draw?: boolean;
  reason?: 'no-moves' | 'no-pieces' | 'no-progress' | 'repetition';
}

/** Side to move with no legal moves (blocked or wiped out) loses. */
export function gameOverState(
  board: Board,
  toMove: CheckersColor,
  rules: CheckersRules = DEFAULT_RULES,
  pliesWithoutProgress = 0,
  repetitionCount = 0,
): CheckersGameOver {
  if (legalMoves(board, toMove, rules).length === 0) {
    const anyPiece = board.some((p) => colorOf(p) === toMove);
    return {
      over: true,
      winner: opponent(toMove),
      reason: anyPiece ? 'no-moves' : 'no-pieces',
    };
  }
  if (pliesWithoutProgress >= 80) return { over: true, draw: true, reason: 'no-progress' };
  if (repetitionCount >= 3) return { over: true, draw: true, reason: 'repetition' };
  return { over: false };
}

export function boardKey(board: Board, toMove: CheckersColor): string {
  return toMove + ':' + Array.from(board).join(',');
}

/** A move resets the no-progress counter if it captures or moves a man. */
export function isProgressMove(board: Board, move: CheckersMove): boolean {
  return move.captures.length > 0 || !isKing(board[move.from]);
}
