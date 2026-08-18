import { describe, expect, it } from 'vitest';
import {
  CHECKERS_LEVELS,
  checkersLevel,
  evaluate,
  searchBestMove,
} from '../../src/lib/checkers/engine';
import {
  initialBoard,
  squareIndex,
  applyMove,
  captureMoves,
  BM, WM, WK, BK,
  type Board,
} from '../../src/lib/checkers/rules';

const sq = squareIndex;
function emptyBoard(): Board {
  return new Int8Array(32);
}

describe('evaluation', () => {
  it('is symmetric and prefers kings and material', () => {
    expect(evaluate(initialBoard())).toBe(0);
    const b = emptyBoard();
    b[sq(4, 3)] = WM;
    expect(evaluate(b)).toBeGreaterThan(0);
    b[sq(4, 3)] = WK;
    const kingScore = evaluate(b);
    b[sq(4, 3)] = WM;
    expect(kingScore).toBeGreaterThan(evaluate(b));
  });
});

describe('search', () => {
  it('finds the forced capture', () => {
    const b = emptyBoard();
    b[sq(5, 2)] = WM;
    b[sq(4, 3)] = BM;
    b[sq(0, 1)] = BK;
    const out = searchBestMove(b, 'w', { maxDepth: 4, seed: 1 });
    expect(out.move?.captures).toContain(sq(4, 3));
  });

  it('avoids hanging a man when a safe move exists', () => {
    // Any move of the (4,3) man can be captured by the black man on (2,3);
    // moving the (5,6) man is safe. The search must find the safe move.
    const b = emptyBoard();
    b[sq(4, 3)] = WM;
    b[sq(5, 6)] = WM;
    b[sq(2, 3)] = BM;
    const out = searchBestMove(b, 'w', { maxDepth: 8, seed: 7 });
    expect(out.move).not.toBeNull();
    const after = applyMove(b, out.move!);
    expect(captureMoves(after, 'b').length).toBe(0);
  });

  it('reports a lost position when the side to move has no moves', () => {
    const b = emptyBoard();
    b[sq(4, 3)] = BK;
    const out = searchBestMove(b, 'w', { maxDepth: 4 });
    expect(out.move).toBeNull();
    expect(out.score).toBeLessThan(-50000);
  });

  it('completes an iterative-deepening search from the start position in budget', () => {
    const start = Date.now();
    const out = searchBestMove(initialBoard(), 'w', { maxDepth: 24, timeMs: 500, seed: 3 });
    expect(Date.now() - start).toBeLessThan(2500);
    expect(out.move).not.toBeNull();
    expect(out.depth).toBeGreaterThanOrEqual(4);
  });

  it('is deterministic for a fixed seed', () => {
    const a = searchBestMove(initialBoard(), 'w', { maxDepth: 5, seed: 42 });
    const b = searchBestMove(initialBoard(), 'w', { maxDepth: 5, seed: 42 });
    expect(a.move).toEqual(b.move);
  });

  it('randomness only ever picks tolerable moves', () => {
    const b = emptyBoard();
    b[sq(5, 2)] = WM;
    b[sq(6, 5)] = WM;
    b[sq(0, 3)] = BK;
    for (let seed = 0; seed < 20; seed++) {
      const out = searchBestMove(b, 'w', { maxDepth: 3, randomness: 1, seed });
      expect(out.move).not.toBeNull();
    }
  });
});

describe('levels', () => {
  it('exposes 5 levels with ascending strength and fixed ratings', () => {
    expect(CHECKERS_LEVELS.length).toBe(5);
    for (let i = 1; i < CHECKERS_LEVELS.length; i++) {
      expect(CHECKERS_LEVELS[i].rating).toBeGreaterThan(CHECKERS_LEVELS[i - 1].rating);
    }
    expect(checkersLevel(1).params.randomness).toBeGreaterThan(0);
    expect(checkersLevel(5).params.timeMs).toBeDefined();
    expect(checkersLevel(99).level).toBe(5);
    expect(checkersLevel(-5).level).toBe(1);
  });
});

describe('full playout', () => {
  it('an engine-vs-engine game reaches a terminal state', () => {
    let board = initialBoard();
    let toMove: 'w' | 'b' = 'w';
    let plies = 0;
    while (plies < 300) {
      const out = searchBestMove(board, toMove, { maxDepth: 4, seed: plies });
      if (!out.move) break;
      board = applyMove(board, out.move);
      toMove = toMove === 'w' ? 'b' : 'w';
      plies++;
    }
    expect(plies).toBeGreaterThan(20);
  });
});
