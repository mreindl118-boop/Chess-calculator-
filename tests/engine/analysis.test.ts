import { describe, expect, it } from 'vitest';
import {
  aggregateAnalysis,
  classify,
  moveAccuracy,
  scoreToCp,
  stickyReorder,
  winPercent,
} from '../../src/lib/engine/analysis';
import { parseInfoLine, type EngineInfo } from '../../src/lib/engine/uci';

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

describe('stickyReorder (best-move stability)', () => {
  const line = (uci: string, cp: number): EngineInfo => ({
    depth: 20,
    multipv: 1,
    pv: [uci],
    scoreCp: cp,
  });
  const ucis = (ls: EngineInfo[]) => ls.map((l) => l.pv[0]);

  it('never leaves a clearly-worse move on top (the intransitivity bug)', () => {
    // The reviewer's counterexample: a hysteresis chain A=0,B=15,C=40 (H=30),
    // engine emits best-first [C,B,A], prior order [A,B,C]. The old comparator
    // (Math.abs(diff)>=H ? diff : slotdiff) is intransitive and could pin A
    // (40cp worse than the best) into slot 0. The guarantee we need: slot 0 is
    // always within a whisker of the true best, so the highlighted move and the
    // eval bar can never be a blunder. (B may legitimately sit above C — they
    // are within the whisker and B ranked higher before: that's the anti-flicker
    // behaviour, not a bug.)
    const A = line('a1a2', 0);
    const B = line('b1b2', 15);
    const C = line('c1c2', 40);
    const out = stickyReorder([C, B, A], ['a1a2', 'b1b2', 'c1c2'], 30);
    const best = Math.max(...out.map(scoreToCp));
    expect(scoreToCp(out[0])).toBeGreaterThanOrEqual(best - 30); // slot 0 within a whisker of best
    expect(out[out.length - 1].pv[0]).toBe('a1a2'); // the 40cp-worse move stays last
  });

  it('is order-independent for identical inputs (a valid comparator)', () => {
    // Feed the same three lines in several permutations; slot 0 must always be
    // within a whisker of the best (an intransitive sort would vary the output).
    const mk = () => [line('a1a2', 0), line('b1b2', 15), line('c1c2', 40)];
    for (const perm of [[0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1]]) {
      const arr = mk();
      const out = stickyReorder(perm.map((i) => arr[i]), ['a1a2', 'b1b2', 'c1c2'], 30);
      expect(scoreToCp(out[0])).toBeGreaterThanOrEqual(40 - 30);
      expect(out[out.length - 1].pv[0]).toBe('a1a2');
    }
  });

  it('holds near-equal neighbours in their prior slots (no flicker)', () => {
    // Two moves within the whisker keep their prior order even when the engine
    // momentarily rates the second one a hair higher.
    const first = line('e2e4', 18);
    const second = line('d2d4', 22);
    const out = stickyReorder([second, first], ['e2e4', 'd2d4'], 30);
    expect(ucis(out)).toEqual(['e2e4', 'd2d4']);
  });

  it('promotes a move once it is clearly better than the whisker', () => {
    const incumbent = line('e2e4', 20);
    const challenger = line('d2d4', 60); // 40cp better, beyond hysteresis
    const out = stickyReorder([incumbent, challenger], ['e2e4', 'd2d4'], 30);
    expect(out[0].pv[0]).toBe('d2d4');
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
