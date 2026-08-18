import { describe, expect, it } from 'vitest';
import {
  aggregateAnalysis,
  classify,
  moveAccuracy,
  scoreToCp,
  winPercent,
} from '../../src/lib/engine/analysis';
import { parseInfoLine } from '../../src/lib/engine/uci';

describe('score plumbing', () => {
  it('parses UCI info lines', () => {
    const info = parseInfoLine(
      'info depth 18 seldepth 24 multipv 2 score cp -35 nodes 123456 nps 500000 time 246 pv e2e4 e7e5 g1f3',
    )!;
    expect(info.depth).toBe(18);
    expect(info.multipv).toBe(2);
    expect(info.scoreCp).toBe(-35);
    expect(info.pv).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(parseInfoLine('info depth 5 currmove e2e4')).toBeNull();
    const mate = parseInfoLine('info depth 12 multipv 1 score mate -3 pv h7h8')!;
    expect(mate.scoreMate).toBe(-3);
  });

  it('maps mate scores onto the cp scale', () => {
    expect(scoreToCp({ scoreMate: 2 })).toBe(9998);
    expect(scoreToCp({ scoreMate: -2 })).toBe(-9998);
    expect(scoreToCp({ scoreCp: 42 })).toBe(42);
  });

  it('win percent is monotonic and centered', () => {
    expect(winPercent(0)).toBeCloseTo(50);
    expect(winPercent(300)).toBeGreaterThan(winPercent(100));
    expect(winPercent(-300)).toBeLessThan(winPercent(-100));
    expect(winPercent(5000)).toBeLessThanOrEqual(100);
  });
});

describe('classification', () => {
  it('grades by centipawn loss', () => {
    expect(classify(0, true)).toBe('best');
    expect(classify(8, false)).toBe('best');
    expect(classify(20, false)).toBe('excellent');
    expect(classify(40, false)).toBe('good');
    expect(classify(80, false)).toBe('inaccuracy');
    expect(classify(200, false)).toBe('mistake');
    expect(classify(400, false)).toBe('blunder');
  });

  it('accuracy decays with win% drop', () => {
    expect(moveAccuracy(50, 50)).toBeGreaterThan(99);
    expect(moveAccuracy(50, 30)).toBeLessThan(moveAccuracy(50, 45));
    expect(moveAccuracy(90, 5)).toBeGreaterThanOrEqual(0);
  });
});

describe('aggregateAnalysis', () => {
  it('attributes losses to the right side and counts classes', () => {
    // evals (white POV): start 0, after white blunder -300, after black reply -280
    const evals = [0, -300, -280];
    const moves = [
      { color: 'w' as const, uci: 'f2f3' },
      { color: 'b' as const, uci: 'e7e5' },
    ];
    const best = ['e2e4', 'e7e5'];
    const a = aggregateAnalysis(evals, best, moves);
    expect(a.moves[0].class).toBe('blunder');
    expect(a.moves[0].cpLoss).toBe(300);
    expect(a.moves[1].class).toBe('best'); // played the engine move
    expect(a.moves[1].accuracy).toBe(100);
    expect(a.counts.w.blunder).toBe(1);
    expect(a.counts.b.best).toBe(1);
    expect(a.acpl.w).toBe(300);
    // ACPL counts the raw eval drift even on "best" moves (engine noise).
    expect(a.acpl.b).toBe(20);
    expect(a.accuracy.b).toBeGreaterThan(a.accuracy.w);
  });

  it('a move that improves the eval never counts as a loss', () => {
    const evals = [0, 500, 480];
    const a = aggregateAnalysis(
      evals,
      ['a2a3', 'b7b6'],
      [
        { color: 'w' as const, uci: 'd2d4' },
        { color: 'b' as const, uci: 'b7b6' },
      ],
    );
    expect(a.moves[0].cpLoss).toBe(0);
    expect(a.moves[0].class).toBe('best');
  });
});
