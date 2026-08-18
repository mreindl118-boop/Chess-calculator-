import { mulberry32, pickWeighted, randomSeed, type Rng } from '../util/rng';

export interface RbcOptions {
  /** 'chaos': both armies fully random. 'handicap': weaker side gets a stronger army. */
  mode: 'chaos' | 'handicap';
  seed?: number;
  /**
   * Rating gap for handicap mode, positive = white is the stronger player
   * (so black receives the stronger army). Ignored in chaos mode.
   */
  ratingGap?: number;
}

const PIECES = ['p', 'n', 'b', 'r', 'q'] as const;

/**
 * Piece-draw weights. bias 0 = pawn-heavy (roughly normal material),
 * bias 1 = queen/rook-heavy monster army.
 */
function weightsFor(bias: number): number[] {
  const b = Math.min(1, Math.max(0, bias));
  return [
    8 * (1 - b) + 1, // p
    2.4 + 1.2 * b, // n
    2.4 + 1.2 * b, // b
    1.6 + 3.4 * b, // r
    0.8 + 4.2 * b, // q
  ];
}

/** Map a rating gap (0..800+) to an army-strength bias boost for the weaker side. */
export function handicapBias(ratingGap: number): number {
  const g = Math.min(800, Math.abs(ratingGap));
  return 0.25 + 0.65 * (g / 800);
}

function drawArmy(rng: Rng, bias: number): string[] {
  // 15 random pieces + the king. Index 0..7 = back rank, 8..15 = pawn rank.
  const weights = weightsFor(bias);
  const army: string[] = [];
  for (let i = 0; i < 16; i++) {
    if (i === 4) {
      army.push('k'); // king stays on its home square (e-file, back rank)
      continue;
    }
    let piece = pickWeighted(rng, PIECES, weights);
    // No pawns on the back rank: a pawn on rank 1/8 is not a legal FEN.
    if (i < 8 && piece === 'p') piece = pickWeighted(rng, PIECES.slice(1), weights.slice(1));
    army.push(piece);
  }
  return army;
}

/**
 * Generate a Really Bad Chess start FEN. Both sides always have their king on
 * the e-file home square; every other one of their 16 squares gets a random
 * piece. No castling, white to move.
 */
export function reallyBadChessFen(opts: RbcOptions): { fen: string; seed: number } {
  const seed = opts.seed ?? randomSeed();
  const rng = mulberry32(seed);

  let whiteBias = 0.35;
  let blackBias = 0.35;
  if (opts.mode === 'handicap' && opts.ratingGap && opts.ratingGap !== 0) {
    const boost = handicapBias(opts.ratingGap);
    if (opts.ratingGap > 0) blackBias += boost;
    else whiteBias += boost;
  } else if (opts.mode === 'chaos') {
    // Fully independent random strengths.
    whiteBias = rng() * 0.9;
    blackBias = rng() * 0.9;
  }

  const white = drawArmy(rng, whiteBias); // 0..7 rank 1, 8..15 rank 2
  const black = drawArmy(rng, blackBias); // 0..7 rank 8, 8..15 rank 7

  const rank8 = black.slice(0, 8).join('');
  const rank7 = black.slice(8, 16).join('');
  const rank2 = white.slice(8, 16).join('').toUpperCase();
  const rank1 = white.slice(0, 8).join('').toUpperCase();

  const fen = `${rank8}/${rank7}/8/8/8/8/${rank2}/${rank1} w - - 0 1`;
  return { fen, seed };
}
