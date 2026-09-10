import { describe, expect, it } from 'vitest';
import { isBrilliantPlayed, sacLabel } from '../../src/lib/engine/brilliant';
import { aggregateAnalysis } from '../../src/lib/engine/analysis';

describe('sacLabel', () => {
  it('names the sacrificed piece with the invested amount', () => {
    expect(sacLabel('q', 9)).toBe('Queen sac −9');
    expect(sacLabel('r', 5)).toBe('Rook sac −5');
    expect(sacLabel('b', 3)).toBe('Bishop sac −3');
    expect(sacLabel('n', 3)).toBe('Knight sac −3');
    expect(sacLabel('p', 1)).toBe('Pawn sac −1');
  });
});

describe('isBrilliantPlayed', () => {
  // Qd1-d5 walks into the e6 pawn: a real queen sacrifice by SEE.
  const sacFen = '4k3/8/4p3/8/8/8/8/3QK3 w - - 0 1';
  // Rd1xd5 loses the exchange (a spicy, not psychotic, sacrifice).
  const spicyFen = '4k3/8/4p3/3p4/8/8/8/3RK3 w - - 0 1';

  it('is true only when the move is a sacrifice AND a forced mate follows', () => {
    expect(isBrilliantPlayed(sacFen, 'd1d5', true)).toBe(true);
    expect(isBrilliantPlayed(sacFen, 'd1d5', false)).toBe(false); // no mate → not brilliant
    expect(isBrilliantPlayed(sacFen, 'd1d2', true)).toBe(false); // not a sacrifice
  });

  it('respects the magnitude floor', () => {
    expect(isBrilliantPlayed(spicyFen, 'd1d5', true, 'spicy')).toBe(true);
    expect(isBrilliantPlayed(spicyFen, 'd1d5', true, 'psychotic')).toBe(false); // spicy < psychotic
  });
});

describe('aggregateAnalysis with brilliant flags', () => {
  it('badges a flagged move as brilliant and counts it as best for accuracy', () => {
    const evals = [50, 9990]; // white forces mate on move 1
    const moves = [{ color: 'w' as const, uci: 'd1h5' }];
    const a = aggregateAnalysis(evals, ['d1h5'], moves, [true]);
    expect(a.moves[0].class).toBe('brilliant');
    expect(a.moves[0].accuracy).toBe(100);
    expect(a.counts.w.brilliant).toBe(1);
    expect(a.accuracy.w).toBe(100);
  });

  it('leaves normal moves unchanged when no flags are given', () => {
    const evals = [0, -300, -280];
    const a = aggregateAnalysis(
      evals,
      ['e2e4', 'e7e5'],
      [
        { color: 'w' as const, uci: 'f2f3' },
        { color: 'b' as const, uci: 'e7e5' },
      ],
    );
    expect(a.moves[0].class).toBe('blunder');
    expect(a.counts.w.brilliant).toBe(0);
  });
});
