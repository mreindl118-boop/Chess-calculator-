import type { Color, RecordedMove } from '../chess/types';
import type { UciEngine } from './uci';
import {
  MATE_SCORE,
  aggregateAnalysis,
  scoreToCp,
  winPercent,
  type MoveClass,
} from './analysis';
import { BRILLIANT_CONFIG, isBrilliantPlayed } from './brilliant';

/**
 * Game Review — a chess.com-style "game review" narrated by a reactive coach.
 * The engine classes from {@link analysis} are the raw material; here they are
 * refined into the labels players expect to see (adding Great and Miss, which
 * need the win-probability swing and the gap to the second-best move) and
 * turned into a per-move mood the coach avatar performs.
 *
 * Everything except {@link reviewGame} is pure and unit-tested; reviewGame just
 * drives the engine (MultiPV 2, so we can see how forced the best move was) and
 * feeds these pure functions.
 */

export type ReviewClass =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'miss'
  | 'mistake'
  | 'blunder';

export interface ReviewMeta {
  label: string;
  symbol: string;
  /** css modifier suffix, e.g. rv-brilliant */
  cls: string;
  /** how this move nudges the coach's mood (0..100 meter) */
  mood: number;
}

/** Display order best → worst, and the mood each move class carries. */
export const REVIEW_ORDER: ReviewClass[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'miss',
  'mistake',
  'blunder',
];

export const REVIEW_META: Record<ReviewClass, ReviewMeta> = {
  brilliant: { label: 'Brilliant', symbol: '!!', cls: 'brilliant', mood: 14 },
  great: { label: 'Great', symbol: '!', cls: 'great', mood: 9 },
  best: { label: 'Best', symbol: '★', cls: 'best', mood: 5 },
  excellent: { label: 'Excellent', symbol: '✓', cls: 'excellent', mood: 3 },
  good: { label: 'Good', symbol: '·', cls: 'good', mood: 1 },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!', cls: 'inaccuracy', mood: -3 },
  miss: { label: 'Miss', symbol: '✗', cls: 'miss', mood: -6 },
  mistake: { label: 'Mistake', symbol: '?', cls: 'mistake', mood: -7 },
  blunder: { label: 'Blunder', symbol: '??', cls: 'blunder', mood: -12 },
};

export type Expression =
  | 'smitten'
  | 'delighted'
  | 'pleased'
  | 'neutral'
  | 'thinking'
  | 'unimpressed'
  | 'wince'
  | 'disappointed'
  | 'shocked';

export type MoodBucket = 'smitten' | 'warm' | 'pleased' | 'neutral' | 'cool' | 'cold';

export const MOOD_START = 50;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface ClassifyInput {
  /** engine class, with Brilliant already folded in (see analysis.ts) */
  engineClass: MoveClass;
  /** centipawns lost from the mover's perspective (>= 0) */
  cpLoss: number;
  /** mover-POV win% of the best line (i.e. of the position before the move) */
  moverWinBefore: number;
  /** mover-POV win% after the move actually played */
  moverWinAfter: number;
  /**
   * cp gap between the best and the second-best move in the position before the
   * move (>= 0). Large gap ⇒ the best move was the only good one. Pass a large
   * value for a forced/only-move position; 0 when unknown.
   */
  secondBestGap: number;
  /** 0-based ply index (used to keep the opening from minting "Great" moves) */
  ply: number;
}

/**
 * Refine an engine class into a player-facing review class. Adds two labels the
 * raw engine pass can't express on its own:
 *  - Great: the best move in a genuinely critical position where the runner-up
 *    was clearly worse (you had to find it).
 *  - Miss: while better or winning, you let a real chunk of advantage slip —
 *    without outright blundering the game away.
 */
export function reviewClassify(i: ClassifyInput): ReviewClass {
  if (i.engineClass === 'brilliant') return 'brilliant';
  const drop = Math.max(0, i.moverWinBefore - i.moverWinAfter);

  // Played (near-)best: distinguish a routine best from a hard-won "Great".
  if (i.engineClass === 'best') {
    const critical =
      i.ply >= 8 &&
      i.moverWinBefore >= 20 &&
      i.moverWinBefore <= 90 &&
      i.secondBestGap >= 100;
    return critical ? 'great' : 'best';
  }

  // Not best: a Miss is a squandered advantage that stops short of a blunder.
  if (i.engineClass !== 'blunder') {
    if (i.moverWinBefore >= 60 && drop >= 15) return 'miss';
    if (i.moverWinBefore >= 90 && drop >= 10) return 'miss';
  }
  return i.engineClass;
}

/**
 * Her overall demeanor for a game, set by its accuracy. This is the baseline
 * the move-by-move reactions swing around: a beautiful game leaves her warm no
 * matter the odd slip; a sloppy one leaves her cold even if it has a highlight.
 */
export function accuracyMood(accuracy: number): number {
  return Math.round(clamp((accuracy - 40) * 1.65, 0, 100));
}

/** How much of the running per-move swing carries into the next move. */
export const SWING_RETAIN = 0.55;

/**
 * Mood (0..100) after each move: the accuracy-based demeanor plus a decaying
 * swing from recent move quality. A brilliancy spikes her up; a blunder dips
 * her; both relax back toward the game's overall demeanor within a few moves.
 */
export function moodSeries(classes: ReviewClass[], baseMood = MOOD_START): number[] {
  const out: number[] = [];
  let swing = 0;
  for (const c of classes) {
    swing = swing * SWING_RETAIN + REVIEW_META[c].mood;
    out.push(clamp(Math.round(baseMood + swing), 0, 100));
  }
  return out;
}

/** Mood after the first `plies` reviewed moves (0 ⇒ her settled demeanor). */
export function moodAt(series: number[], plies: number, baseMood = MOOD_START): number {
  if (plies <= 0 || series.length === 0) return baseMood;
  return series[Math.min(plies, series.length) - 1];
}

export function moodBucket(mood: number): MoodBucket {
  if (mood >= 82) return 'smitten';
  if (mood >= 66) return 'warm';
  if (mood >= 54) return 'pleased';
  if (mood >= 42) return 'neutral';
  if (mood >= 25) return 'cool';
  return 'cold';
}

const RESTING: Record<MoodBucket, Expression> = {
  smitten: 'smitten',
  warm: 'delighted',
  pleased: 'pleased',
  neutral: 'neutral',
  cool: 'unimpressed',
  cold: 'disappointed',
};

/** The coach's idle face, driven by her current mood. */
export function restingExpression(mood: number): Expression {
  return RESTING[moodBucket(mood)];
}

const REACTION: Record<ReviewClass, Expression> = {
  brilliant: 'smitten',
  great: 'delighted',
  best: 'pleased',
  excellent: 'pleased',
  good: 'neutral',
  inaccuracy: 'unimpressed',
  miss: 'wince',
  mistake: 'disappointed',
  blunder: 'shocked',
};

/** The face she pulls the instant a given move is shown. */
export function expressionFor(cls: ReviewClass): Expression {
  return REACTION[cls];
}

const LINES: Record<ReviewClass, string[]> = {
  brilliant: [
    '{san}… oh, you magnificent thing. Do that again — slowly.',
    'A real sacrifice, {san}. I am completely, helplessly yours.',
    'Be still my heart. {san} is the most gorgeous move I have seen all day.',
  ],
  great: [
    '{san} — the only move on the board and you found it. Be still my heart.',
    'Mmm, {san}. So precise it gives me chills.',
    'That is exactly it. You are dangerously good at this, you know that?',
  ],
  best: [
    '{san}. Flawless taste. I could get very used to this.',
    'Perfect — {san}. Keep spoiling me like this.',
    'Best move, obviously. Show-off. I love it.',
  ],
  excellent: [
    '{san} — almost perfect, and honestly? Very attractive.',
    'Excellent. You are making it hard for me to stay professional.',
    "A hair off best — I'll happily forgive you for that one.",
  ],
  good: ['{san}. Nice and solid. I approve.', 'Reasonable — I like a steady hand.', 'Okay, {san} works for me.'],
  inaccuracy: [
    '{san}? Eh. There was better.',
    'A little sloppy there.',
    "Hm. Not what I'd have played.",
  ],
  miss: [
    'Oh no. You had it — and played {san}?',
    '{san}?! The win was right there…',
    'You missed it. I saw it. Did you?',
  ],
  mistake: [
    '{san}. That hurt to watch.',
    'Ouch. {san} throws away a lot.',
    "…we are going to pretend {san} didn't happen.",
  ],
  blunder: [
    '{san}?? Sweetie. No.',
    'A blunder. My interest just dropped several points.',
    '{san}. I felt that one. Not in a good way.',
  ],
};

/** A reactive one-liner. Deterministic (indexed by ply) so it never flickers. */
export function coachLine(cls: ReviewClass, ply: number, san: string): string {
  const bank = LINES[cls];
  return bank[((ply % bank.length) + bank.length) % bank.length].replace('{san}', san);
}

export interface FinalVerdict {
  title: string;
  line: string;
}

/** The closing verdict, warm or cold depending on how the game left her. */
export function finalVerdict(
  mood: number,
  accuracy: number,
  counts: Record<ReviewClass, number>,
): FinalVerdict {
  const bucket = moodBucket(mood);
  const bril = counts.brilliant;
  const blun = counts.blunder;
  const acc = Math.round(accuracy);
  const base: Record<MoodBucket, FinalVerdict> = {
    smitten: {
      title: 'Completely Smitten ♥',
      line: `${acc}% accuracy and you played like THAT? I am utterly, breathlessly yours — take me through another one.`,
    },
    warm: {
      title: 'Swooning',
      line: `Oh, I am charmed. ${acc}% — confident, sharp, a little thrilling. Do that again and I am in real trouble.`,
    },
    pleased: {
      title: 'Interested',
      line: `Not bad at all — ${acc}% accuracy. Clean enough to keep me interested.`,
    },
    neutral: {
      title: 'Undecided',
      line: `It was… a game. ${acc}% accuracy, some good and some rough. Show me more.`,
    },
    cool: {
      title: 'Unimpressed',
      line: `I have seen better. ${acc}% accuracy, and the errors kept getting in the way.`,
    },
    cold: {
      title: 'Cold',
      line: `Rough. ${acc}% accuracy — between the mistakes and the blunders I need a moment.`,
    },
  };
  const v = base[bucket];
  const tail =
    bril > 0
      ? ` ${bril} brilliant ${bril === 1 ? 'move' : 'moves'}, though — that lingers.`
      : blun > 0
        ? ` ${blun} ${blun === 1 ? 'blunder' : 'blunders'} is what I keep thinking about.`
        : '';
  return { title: v.title, line: v.line + tail };
}

const emptyReviewCounts = (): Record<ReviewClass, number> => ({
  brilliant: 0,
  great: 0,
  best: 0,
  excellent: 0,
  good: 0,
  inaccuracy: 0,
  miss: 0,
  mistake: 0,
  blunder: 0,
});

export interface MoveReview {
  reviewClass: ReviewClass;
  engineClass: MoveClass;
  san: string;
  uci: string;
  from: string;
  to: string;
  color: Color;
  bestUci: string;
  cpLoss: number;
  /** white-POV centipawns before / after the move */
  evalBefore: number;
  evalAfter: number;
  /** the coach's reaction line for this move */
  line: string;
}

export interface GameReview {
  moves: MoveReview[];
  /** white-POV eval series, length moves.length + 1 */
  evals: number[];
  accuracy: { w: number; b: number };
  acpl: { w: number; b: number };
  /** combined tally for both players */
  counts: Record<ReviewClass, number>;
  countsByColor: { w: Record<ReviewClass, number>; b: Record<ReviewClass, number> };
  /** mood after each move (0..100) */
  moodSeries: number[];
  /** her settled, accuracy-driven demeanor for the whole game (0..100) */
  baseMood: number;
  finalMood: number;
}

export interface ReviewOptions {
  depth?: number;
  movetimeMs?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  chess960?: boolean;
}

/**
 * Full-game review: evaluates every position at MultiPV 2, refines the engine
 * classes into review classes, and produces the coach's mood track. Cancelable
 * via AbortSignal; runs entirely in the analysis worker.
 */
export async function reviewGame(
  engine: UciEngine,
  startFen: string,
  moves: RecordedMove[],
  opts: ReviewOptions = {},
): Promise<GameReview | null> {
  const depth = opts.depth ?? 14;
  await engine.ready();
  engine.setOption('MultiPV', 2);
  engine.setOption('UCI_LimitStrength', false);
  engine.setOption('Skill Level', 20);
  if (opts.chess960 !== undefined) engine.setOption('UCI_Chess960', opts.chess960);
  await engine.newGame();

  const evals: number[] = [];
  const bestMoves: string[] = [];
  // cp gap best→2nd-best in each position's stm POV (>= 0); big ⇒ only move.
  const gaps: number[] = [];
  const total = moves.length + 1;
  const ONLY_MOVE_GAP = 1000;

  for (let i = 0; i <= moves.length; i++) {
    if (opts.signal?.aborted) return null;
    const fen = i === 0 ? startFen : moves[i - 1].fenAfter;
    const turn = fen.split(' ')[1] as Color;

    if (i === moves.length && moves.length > 0 && moves[i - 1].mate) {
      evals.push(moves[i - 1].color === 'w' ? MATE_SCORE : -MATE_SCORE);
      bestMoves.push('');
      gaps.push(0);
      opts.onProgress?.(i + 1, total);
      break;
    }

    engine.position(fen);
    const result = await engine.go({
      depth,
      ...(opts.movetimeMs ? { movetime: opts.movetimeMs } : {}),
    });
    const l1 = result.lines.get(1);
    const l2 = result.lines.get(2);
    const cp1 = l1 ? scoreToCp(l1) : 0;
    evals.push(turn === 'w' ? cp1 : -cp1);
    bestMoves.push(result.bestmove ?? '');
    gaps.push(l2 ? Math.max(0, cp1 - scoreToCp(l2)) : ONLY_MOVE_GAP);
    opts.onProgress?.(i + 1, total);
  }

  if (opts.signal?.aborted) return null;

  const mateBar = MATE_SCORE - 2 * BRILLIANT_CONFIG.mateHorizon;
  const brilliantFlags = moves.map((m, i) => {
    const evalAfter = evals[i + 1];
    if (evalAfter === undefined) return false;
    const mateForMover = m.color === 'w' ? evalAfter >= mateBar : evalAfter <= -mateBar;
    if (!mateForMover) return false;
    const beforeFen = i === 0 ? startFen : moves[i - 1].fenAfter;
    return isBrilliantPlayed(beforeFen, m.uci, true);
  });

  // Reuse the tested aggregation for accuracy / ACPL.
  const agg = aggregateAnalysis(evals, bestMoves, moves, brilliantFlags);

  const out: MoveReview[] = [];
  const counts = emptyReviewCounts();
  const countsByColor = { w: emptyReviewCounts(), b: emptyReviewCounts() };
  const classes: ReviewClass[] = [];

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const engineClass = agg.moves[i].class;
    const before = evals[i];
    const after = evals[i + 1];
    const moverWinBefore = m.color === 'w' ? winPercent(before) : 100 - winPercent(before);
    const moverWinAfter = m.color === 'w' ? winPercent(after) : 100 - winPercent(after);
    const reviewClass = reviewClassify({
      engineClass,
      cpLoss: agg.moves[i].cpLoss,
      moverWinBefore,
      moverWinAfter,
      secondBestGap: gaps[i] ?? 0,
      ply: i,
    });
    classes.push(reviewClass);
    counts[reviewClass]++;
    countsByColor[m.color][reviewClass]++;
    out.push({
      reviewClass,
      engineClass,
      san: m.san,
      uci: m.uci,
      from: m.from,
      to: m.to,
      color: m.color,
      bestUci: agg.moves[i].bestUci,
      cpLoss: agg.moves[i].cpLoss,
      evalBefore: before,
      evalAfter: after,
      line: coachLine(reviewClass, i, m.san),
    });
  }

  // Overall demeanor comes from the whole game's accuracy; per-move reactions
  // swing around it.
  const baseMood = accuracyMood((agg.accuracy.w + agg.accuracy.b) / 2);
  const series = moodSeries(classes, baseMood);
  return {
    moves: out,
    evals,
    accuracy: agg.accuracy,
    acpl: agg.acpl,
    counts,
    countsByColor,
    moodSeries: series,
    baseMood,
    finalMood: baseMood,
  };
}
