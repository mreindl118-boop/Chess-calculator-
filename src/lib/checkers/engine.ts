import {
  applyMove,
  colorOf,
  isKing,
  legalMoves,
  opponent,
  rowOf,
  type Board,
  type CheckersColor,
  type CheckersMove,
  type CheckersRules,
  DEFAULT_RULES,
} from './rules';
import { mulberry32, randomSeed, type Rng } from '../util/rng';

export interface SearchParams {
  /** hard depth cap */
  maxDepth: number;
  /** wall-clock budget in ms (iterative deepening cuts off) */
  timeMs?: number;
  /** 0..1 chance to pick a random inferior move at the root (weak levels) */
  randomness?: number;
  rules?: CheckersRules;
  seed?: number;
}

export interface SearchOutcome {
  move: CheckersMove | null;
  score: number;
  depth: number;
  nodes: number;
}

const MAN_VALUE = 100;
const KING_VALUE = 165;
const WIN = 100000;

/** Static eval from White's point of view. */
export function evaluate(board: Board): number {
  let score = 0;
  for (let i = 0; i < 32; i++) {
    const p = board[i];
    if (p === 0) continue;
    const white = p > 0;
    const row = rowOf(i);
    let v = isKing(p) ? KING_VALUE : MAN_VALUE;
    if (!isKing(p)) {
      // advancement: rows toward crowning are worth a bit more
      v += white ? (7 - row) * 4 : row * 4;
      // back-row guards deter enemy crowning
      if (white && row === 7) v += 6;
      if (!white && row === 0) v += 6;
    } else {
      // centralized kings are stronger
      const col = 2 * (i % 4) + ((row + 1) % 2);
      v += 6 - (Math.abs(3.5 - row) + Math.abs(3.5 - col));
    }
    score += white ? v : -v;
  }
  return score;
}

interface SearchCtx {
  rules: CheckersRules;
  deadline: number;
  nodes: number;
  aborted: boolean;
}

function negamax(
  board: Board,
  toMove: CheckersColor,
  depth: number,
  alpha: number,
  beta: number,
  ctx: SearchCtx,
): number {
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && ctx.deadline > 0 && Date.now() > ctx.deadline) {
    ctx.aborted = true;
    return 0;
  }

  const moves = legalMoves(board, toMove, ctx.rules);
  if (moves.length === 0) return -WIN + (100 - depth); // side to move loses

  // Quiescence-ish extension: don't stand pat in the middle of capture storms.
  if (depth <= 0) {
    const hasCaptures = moves[0].captures.length > 0;
    if (!hasCaptures || depth <= -6) {
      const e = evaluate(board);
      return toMove === 'w' ? e : -e;
    }
  }

  // Order: biggest capture sequences first.
  if (moves.length > 1) moves.sort((a, b) => b.captures.length - a.captures.length);

  let best = -Infinity;
  for (const m of moves) {
    const next = applyMove(board, m);
    const score = -negamax(next, opponent(toMove), depth - 1, -beta, -alpha, ctx);
    if (ctx.aborted) return 0;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * Iterative-deepening alpha-beta search. Runs synchronously — call it from a
 * Worker, never the main thread.
 */
export function searchBestMove(
  board: Board,
  toMove: CheckersColor,
  params: SearchParams,
): SearchOutcome {
  const rules = params.rules ?? DEFAULT_RULES;
  const rng: Rng = mulberry32(params.seed ?? randomSeed());
  const rootMoves = legalMoves(board, toMove, rules);
  if (rootMoves.length === 0) return { move: null, score: -WIN, depth: 0, nodes: 0 };
  if (rootMoves.length === 1) {
    return { move: rootMoves[0], score: 0, depth: 0, nodes: 1 };
  }

  const ctx: SearchCtx = {
    rules,
    deadline: params.timeMs ? Date.now() + params.timeMs : 0,
    nodes: 0,
    aborted: false,
  };

  let bestMove = rootMoves[0];
  let bestScore = 0;
  let completedDepth = 0;
  // Root move scores from the deepest completed iteration (for weak levels).
  let rootScores: Array<{ move: CheckersMove; score: number }> = [];

  for (let depth = 1; depth <= params.maxDepth; depth++) {
    let iterBest = -Infinity;
    let iterMove = bestMove;
    const iterScores: Array<{ move: CheckersMove; score: number }> = [];
    // Search the previous best first for better cutoffs.
    const ordered = [bestMove, ...rootMoves.filter((m) => m !== bestMove)];
    let alpha = -Infinity;
    for (const m of ordered) {
      const next = applyMove(board, m);
      const score = -negamax(next, opponent(toMove), depth - 1, -Infinity, -alpha, ctx);
      if (ctx.aborted) break;
      iterScores.push({ move: m, score });
      if (score > iterBest) {
        iterBest = score;
        iterMove = m;
      }
      if (iterBest > alpha) alpha = iterBest;
    }
    if (ctx.aborted) break;
    bestMove = iterMove;
    bestScore = iterBest;
    completedDepth = depth;
    rootScores = iterScores;
    if (bestScore >= WIN - 200 || bestScore <= -WIN + 200) break; // proven result
  }

  // Weak levels: sometimes pick an inferior-but-not-losing move.
  if (params.randomness && params.randomness > 0 && rootScores.length > 1 && rng() < params.randomness) {
    const sorted = [...rootScores].sort((a, b) => b.score - a.score);
    const tolerable = sorted.filter((s) => sorted[0].score - s.score <= MAN_VALUE * 1.5);
    const pick = tolerable[Math.floor(rng() * tolerable.length)] ?? sorted[0];
    return { move: pick.move, score: pick.score, depth: completedDepth, nodes: ctx.nodes };
  }

  return { move: bestMove, score: bestScore, depth: completedDepth, nodes: ctx.nodes };
}

/** AI levels with fixed published ratings for the checkers Elo pool. */
export interface CheckersLevel {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  rating: number;
  params: SearchParams;
}

export const CHECKERS_LEVELS: CheckersLevel[] = [
  { level: 1, name: 'Novice', rating: 600, params: { maxDepth: 2, randomness: 0.5 } },
  { level: 2, name: 'Casual', rating: 900, params: { maxDepth: 4, randomness: 0.25 } },
  { level: 3, name: 'Club', rating: 1300, params: { maxDepth: 7, randomness: 0.1 } },
  { level: 4, name: 'Strong', rating: 1700, params: { maxDepth: 10, timeMs: 1500 } },
  { level: 5, name: 'Expert', rating: 2100, params: { maxDepth: 24, timeMs: 3000 } },
];

export function checkersLevel(level: number): CheckersLevel {
  return CHECKERS_LEVELS[Math.min(4, Math.max(0, level - 1))];
}

export function colorToMoveHasPieces(board: Board, color: CheckersColor): boolean {
  for (let i = 0; i < 32; i++) if (colorOf(board[i]) === color) return true;
  return false;
}
