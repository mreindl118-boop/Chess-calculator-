import type { EngineInfo, UciEngine } from './uci';
import type { Color, RecordedMove } from '../chess/types';

export type MoveClass = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface MoveEval {
  /** eval of the position before the move, white POV centipawns (mate mapped to ±(10000-plies)) */
  evalBefore: number;
  /** eval after the move was played, white POV */
  evalAfter: number;
  /** engine's best move in the before-position (uci) */
  bestUci: string;
  /** centipawn loss from the mover's perspective (>= 0) */
  cpLoss: number;
  class: MoveClass;
  /** per-move accuracy 0-100 */
  accuracy: number;
}

export interface GameAnalysis {
  moves: MoveEval[];
  /** eval series, white POV: index 0 = start position, then after each move */
  evals: number[];
  accuracy: { w: number; b: number };
  acpl: { w: number; b: number };
  counts: { w: Record<MoveClass, number>; b: Record<MoveClass, number> };
}

export const MATE_SCORE = 10000;

export function scoreToCp(info: Pick<EngineInfo, 'scoreCp' | 'scoreMate'>): number {
  if (info.scoreMate !== undefined) {
    return info.scoreMate > 0 ? MATE_SCORE - info.scoreMate : -MATE_SCORE - info.scoreMate;
  }
  return info.scoreCp ?? 0;
}

/** lichess-style win probability (0-100) from a white-POV centipawn eval. */
export function winPercent(cpWhite: number): number {
  const clamped = Math.max(-1500, Math.min(1500, cpWhite));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/** lichess-style per-move accuracy from win% before/after (mover's POV). */
export function moveAccuracy(wpBefore: number, wpAfter: number): number {
  const drop = Math.max(0, wpBefore - wpAfter);
  const raw = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

export function classify(cpLoss: number, playedBest: boolean): MoveClass {
  if (playedBest || cpLoss <= 10) return 'best';
  if (cpLoss <= 25) return 'excellent';
  if (cpLoss <= 50) return 'good';
  if (cpLoss <= 100) return 'inaccuracy';
  if (cpLoss <= 250) return 'mistake';
  return 'blunder';
}

const emptyCounts = (): Record<MoveClass, number> => ({
  best: 0,
  excellent: 0,
  good: 0,
  inaccuracy: 0,
  mistake: 0,
  blunder: 0,
});

/**
 * Pure aggregation step: given the white-POV eval of every position in the
 * game (evals[i] = before move i, evals[n] = final) and the engine's best move
 * per position, produce classifications, accuracy and ACPL.
 */
export function aggregateAnalysis(
  evals: number[],
  bestMoves: string[],
  moves: Pick<RecordedMove, 'color' | 'uci'>[],
): GameAnalysis {
  const out: MoveEval[] = [];
  const acplSum = { w: 0, b: 0 };
  const accSum = { w: 0, b: 0 };
  const n = { w: 0, b: 0 };
  const counts = { w: emptyCounts(), b: emptyCounts() };

  for (let i = 0; i < moves.length; i++) {
    const color: Color = moves[i].color;
    const sign = color === 'w' ? 1 : -1;
    const before = evals[i];
    const after = evals[i + 1];
    const cpLoss = Math.max(0, sign * (before - after));
    const playedBest = moves[i].uci === bestMoves[i];
    const wpBefore = color === 'w' ? winPercent(before) : 100 - winPercent(before);
    const wpAfter = color === 'w' ? winPercent(after) : 100 - winPercent(after);
    const acc = playedBest ? 100 : moveAccuracy(wpBefore, wpAfter);
    const cls = classify(cpLoss, playedBest);
    out.push({
      evalBefore: before,
      evalAfter: after,
      bestUci: bestMoves[i],
      cpLoss,
      class: cls,
      accuracy: acc,
    });
    acplSum[color] += Math.min(1000, cpLoss);
    accSum[color] += acc;
    n[color]++;
    counts[color][cls]++;
  }

  return {
    moves: out,
    evals,
    accuracy: {
      w: n.w ? round1(accSum.w / n.w) : 100,
      b: n.b ? round1(accSum.b / n.b) : 100,
    },
    acpl: {
      w: n.w ? Math.round(acplSum.w / n.w) : 0,
      b: n.b ? Math.round(acplSum.b / n.b) : 0,
    },
    counts,
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export interface AnalyzeOptions {
  depth?: number;
  movetimeMs?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** set UCI_Chess960 before analyzing */
  chess960?: boolean;
}

/**
 * Full-game background analysis: evaluates every position once with the given
 * engine and aggregates. Cancelable via AbortSignal; runs entirely in the
 * engine worker, position by position.
 */
export async function analyzeGame(
  engine: UciEngine,
  startFen: string,
  moves: RecordedMove[],
  opts: AnalyzeOptions = {},
): Promise<GameAnalysis | null> {
  const depth = opts.depth ?? 12;
  await engine.ready();
  engine.setOption('MultiPV', 1);
  engine.setOption('UCI_LimitStrength', false);
  engine.setOption('Skill Level', 20);
  if (opts.chess960 !== undefined) engine.setOption('UCI_Chess960', opts.chess960);
  await engine.newGame();

  const evals: number[] = [];
  const bestMoves: string[] = [];
  const total = moves.length + 1;

  for (let i = 0; i <= moves.length; i++) {
    if (opts.signal?.aborted) return null;
    const fen = i === 0 ? startFen : moves[i - 1].fenAfter;
    const turn = fen.split(' ')[1] as Color;

    // Terminal positions get exact scores without a search.
    if (i === moves.length && moves.length > 0 && moves[i - 1].mate) {
      evals.push(moves[i - 1].color === 'w' ? MATE_SCORE : -MATE_SCORE);
      bestMoves.push('');
      opts.onProgress?.(i + 1, total);
      break;
    }

    engine.position(fen);
    const result = await engine.go({
      depth,
      ...(opts.movetimeMs ? { movetime: opts.movetimeMs } : {}),
    });
    const last = result.lines.get(1);
    const cpStm = last ? scoreToCp(last) : 0;
    evals.push(turn === 'w' ? cpStm : -cpStm);
    bestMoves.push(result.bestmove ?? '');
    opts.onProgress?.(i + 1, total);
  }

  if (opts.signal?.aborted) return null;
  return aggregateAnalysis(evals, bestMoves, moves);
}
