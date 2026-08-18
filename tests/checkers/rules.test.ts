import { describe, expect, it } from 'vitest';
import {
  applyMove,
  captureMoves,
  gameOverState,
  initialBoard,
  legalMoves,
  quietMoves,
  squareIndex,
  BM, BK, WM, WK,
  type Board,
} from '../../src/lib/checkers/rules';

function emptyBoard(): Board {
  return new Int8Array(32);
}
const sq = squareIndex;

describe('board geometry', () => {
  it('maps rows/cols to the 32 dark squares', () => {
    expect(sq(0, 1)).toBe(0);
    expect(sq(0, 7)).toBe(3);
    expect(sq(1, 0)).toBe(4);
    expect(sq(7, 6)).toBe(31);
    expect(sq(0, 0)).toBe(-1); // light square
    expect(sq(-1, 1)).toBe(-1);
    expect(sq(8, 1)).toBe(-1);
  });

  it('initial board has 12 men per side in the right zones', () => {
    const b = initialBoard();
    expect(b.slice(0, 12).every((p) => p === BM)).toBe(true);
    expect(b.slice(12, 20).every((p) => p === 0)).toBe(true);
    expect(b.slice(20).every((p) => p === WM)).toBe(true);
  });
});

describe('quiet moves', () => {
  it('men move one square diagonally forward only', () => {
    const b = emptyBoard();
    b[sq(4, 3)] = WM;
    const moves = quietMoves(b, 'w');
    expect(moves.map((m) => m.to).sort()).toEqual([sq(3, 2), sq(3, 4)].sort());
    b[sq(4, 3)] = BM;
    const black = quietMoves(b, 'b');
    expect(black.map((m) => m.to).sort()).toEqual([sq(5, 2), sq(5, 4)].sort());
  });

  it('kings move in all four directions', () => {
    const b = emptyBoard();
    b[sq(4, 3)] = WK;
    const moves = quietMoves(b, 'w');
    expect(moves.length).toBe(4);
  });

  it('a man reaching the crown row is kinged', () => {
    const b = emptyBoard();
    b[sq(1, 2)] = WM;
    const move = quietMoves(b, 'w').find((m) => m.to === sq(0, 1))!;
    expect(move.crowned).toBe(true);
    const after = applyMove(b, move);
    expect(after[sq(0, 1)]).toBe(WK);
  });
});

describe('captures and multi-jumps', () => {
  it('finds a mandatory double jump and no partial stop', () => {
    const b = emptyBoard();
    b[sq(5, 2)] = WM;
    b[sq(4, 3)] = BM;
    b[sq(2, 3)] = BM;
    const caps = captureMoves(b, 'w');
    expect(caps.length).toBe(1);
    expect(caps[0].to).toBe(sq(1, 2));
    expect(caps[0].captures).toEqual([sq(4, 3), sq(2, 3)]);
    expect(caps[0].path).toEqual([sq(3, 4), sq(1, 2)]);
    const after = applyMove(b, caps[0]);
    expect(after[sq(4, 3)]).toBe(0);
    expect(after[sq(2, 3)]).toBe(0);
    expect(after[sq(1, 2)]).toBe(WM);
  });

  it('offers both branches of a forked multi-jump', () => {
    const b = emptyBoard();
    b[sq(5, 2)] = WM;
    b[sq(4, 3)] = BM;
    // after landing on (3,4) two continuations: over (2,3) or over (2,5)
    b[sq(2, 3)] = BM;
    b[sq(2, 5)] = BM;
    const caps = captureMoves(b, 'w');
    expect(caps.length).toBe(2);
    expect(caps.every((c) => c.captures.length === 2)).toBe(true);
  });

  it('forced capture: quiet moves are excluded when a capture exists', () => {
    const b = emptyBoard();
    b[sq(5, 2)] = WM;
    b[sq(4, 3)] = BM;
    const forced = legalMoves(b, 'w', { forcedCapture: true, flyingKings: false });
    expect(forced.every((m) => m.captures.length > 0)).toBe(true);
    const relaxed = legalMoves(b, 'w', { forcedCapture: false, flyingKings: false });
    expect(relaxed.some((m) => m.captures.length === 0)).toBe(true);
    expect(relaxed.some((m) => m.captures.length > 0)).toBe(true);
  });

  it('men cannot capture backwards', () => {
    const b = emptyBoard();
    b[sq(3, 2)] = WM;
    b[sq(4, 3)] = BM; // behind the white man
    expect(captureMoves(b, 'w').length).toBe(0);
  });

  it('kings capture in all directions', () => {
    const b = emptyBoard();
    b[sq(3, 2)] = WK;
    b[sq(4, 3)] = BM;
    const caps = captureMoves(b, 'w');
    expect(caps.length).toBe(1);
    expect(caps[0].to).toBe(sq(5, 4));
  });

  it('crowning mid-jump ends the sequence immediately', () => {
    const b = emptyBoard();
    b[sq(2, 1)] = WM;
    b[sq(1, 2)] = BM;
    // A further backwards capture would exist for a king; the fresh king must stop.
    b[sq(1, 4)] = BM;
    const caps = captureMoves(b, 'w');
    expect(caps.length).toBe(1);
    expect(caps[0].to).toBe(sq(0, 3));
    expect(caps[0].captures).toEqual([sq(1, 2)]);
    expect(caps[0].crowned).toBe(true);
    const after = applyMove(b, caps[0]);
    expect(after[sq(0, 3)]).toBe(WK);
    expect(after[sq(1, 4)]).toBe(BM); // survives this turn
  });

  it('the same piece cannot be jumped twice in one sequence', () => {
    // Circular setup: white king with black men arranged in a loop.
    const b = emptyBoard();
    b[sq(5, 2)] = WK;
    b[sq(4, 3)] = BM;
    b[sq(2, 3)] = BM;
    b[sq(2, 1)] = BM;
    b[sq(4, 1)] = BM;
    const caps = captureMoves(b, 'w');
    // Full loop captures all 4 and returns to start; no capture repeats a piece.
    for (const c of caps) {
      expect(new Set(c.captures).size).toBe(c.captures.length);
    }
    expect(Math.max(...caps.map((c) => c.captures.length))).toBe(4);
  });

  it('flying kings capture at distance and land anywhere behind', () => {
    const b = emptyBoard();
    b[sq(7, 0)] = WK;
    b[sq(4, 3)] = BM;
    const noFly = captureMoves(b, 'w', { forcedCapture: true, flyingKings: false });
    expect(noFly.length).toBe(0);
    const fly = captureMoves(b, 'w', { forcedCapture: true, flyingKings: true });
    expect(fly.length).toBe(4); // land on (3,4), (2,5), (1,6), (0,7)
    expect(fly.every((m) => m.captures[0] === sq(4, 3))).toBe(true);
  });

  it('flying kings slide any distance on quiet moves', () => {
    const b = emptyBoard();
    b[sq(7, 0)] = WK;
    const slides = quietMoves(b, 'w', { forcedCapture: true, flyingKings: true });
    expect(slides.length).toBe(7); // whole long diagonal
  });
});

describe('game over', () => {
  it('side with no pieces loses', () => {
    const b = emptyBoard();
    b[sq(4, 3)] = WM;
    const state = gameOverState(b, 'b');
    expect(state).toMatchObject({ over: true, winner: 'w', reason: 'no-pieces' });
  });

  it('blocked side with pieces loses', () => {
    // Black man trapped in the corner by white pieces that block both squares.
    const b = emptyBoard();
    b[sq(0, 7)] = BM; // black man in top-right corner moving down
    b[sq(1, 6)] = WK;
    b[sq(2, 5)] = WK; // blocks the jump landing square
    const state = gameOverState(b, 'b');
    expect(state).toMatchObject({ over: true, winner: 'w', reason: 'no-moves' });
  });

  it('draws by no-progress and repetition counters', () => {
    const b = emptyBoard();
    b[sq(4, 3)] = WK;
    b[sq(0, 1)] = BK;
    expect(gameOverState(b, 'w', undefined, 80, 0)).toMatchObject({ over: true, draw: true });
    expect(gameOverState(b, 'w', undefined, 0, 3)).toMatchObject({ over: true, draw: true });
    expect(gameOverState(b, 'w', undefined, 10, 1).over).toBe(false);
  });
});
