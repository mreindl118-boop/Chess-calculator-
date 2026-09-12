import { describe, expect, it } from 'vitest';
import {
  REVIEW_META,
  accuracyMood,
  coachLine,
  expressionFor,
  finalVerdict,
  moodAt,
  moodBucket,
  moodSeries,
  restingExpression,
  reviewClassify,
  type ClassifyInput,
  type ReviewClass,
} from '../../src/lib/engine/review';

const base: ClassifyInput = {
  engineClass: 'good',
  cpLoss: 40,
  moverWinBefore: 50,
  moverWinAfter: 50,
  secondBestGap: 0,
  ply: 20,
};

describe('reviewClassify', () => {
  it('passes Brilliant straight through', () => {
    expect(reviewClassify({ ...base, engineClass: 'brilliant' })).toBe('brilliant');
  });

  it('promotes a critical best move to Great', () => {
    expect(
      reviewClassify({ ...base, engineClass: 'best', moverWinBefore: 55, secondBestGap: 180, ply: 14 }),
    ).toBe('great');
  });

  it('keeps a routine best move as Best when the runner-up is close', () => {
    expect(
      reviewClassify({ ...base, engineClass: 'best', moverWinBefore: 55, secondBestGap: 30, ply: 14 }),
    ).toBe('best');
  });

  it('does not mint Great in the opening', () => {
    expect(
      reviewClassify({ ...base, engineClass: 'best', moverWinBefore: 55, secondBestGap: 300, ply: 4 }),
    ).toBe('best');
  });

  it('does not mint Great when already completely winning (no real choice pressure)', () => {
    expect(
      reviewClassify({ ...base, engineClass: 'best', moverWinBefore: 96, secondBestGap: 300, ply: 20 }),
    ).toBe('best');
  });

  it('labels a squandered advantage as a Miss', () => {
    expect(
      reviewClassify({
        ...base,
        engineClass: 'mistake',
        moverWinBefore: 78,
        moverWinAfter: 55,
      }),
    ).toBe('miss');
  });

  it('flags a small slip while crushing as a Miss (missed the win)', () => {
    expect(
      reviewClassify({
        ...base,
        engineClass: 'inaccuracy',
        moverWinBefore: 94,
        moverWinAfter: 82,
      }),
    ).toBe('miss');
  });

  it('never softens a blunder into a Miss', () => {
    expect(
      reviewClassify({
        ...base,
        engineClass: 'blunder',
        moverWinBefore: 80,
        moverWinAfter: 20,
      }),
    ).toBe('blunder');
  });

  it('leaves an inaccuracy alone when the mover was not ahead', () => {
    expect(
      reviewClassify({
        ...base,
        engineClass: 'inaccuracy',
        moverWinBefore: 45,
        moverWinAfter: 30,
      }),
    ).toBe('inaccuracy');
  });
});

describe('mood', () => {
  it('derives the overall demeanor from accuracy', () => {
    expect(accuracyMood(95)).toBeGreaterThanOrEqual(82); // smitten territory
    expect(accuracyMood(60)).toBeGreaterThan(20);
    expect(accuracyMood(60)).toBeLessThan(45); // cool/neutral
    expect(accuracyMood(40)).toBe(0);
    expect(accuracyMood(200)).toBe(100); // clamped
  });

  it('swings up on good play and down on bad, clamped to 0..100', () => {
    const good: ReviewClass[] = Array(20).fill('brilliant');
    const bad: ReviewClass[] = Array(20).fill('blunder');
    expect(moodSeries(good, 90).at(-1)).toBe(100);
    expect(moodSeries(bad, 10).at(-1)).toBe(0);
  });

  it('starts each series from the accuracy baseline plus the first swing', () => {
    const series = moodSeries(['best', 'blunder'], 80);
    expect(series[0]).toBe(80 + REVIEW_META.best.mood);
    // second move: prior swing decays by SWING_RETAIN, then the blunder lands
    expect(series[1]).toBe(80 + Math.round(REVIEW_META.best.mood * 0.55 + REVIEW_META.blunder.mood));
  });

  it('relaxes back toward the demeanor after a transient dip', () => {
    // a single blunder in an otherwise great game recovers over the next moves
    const s = moodSeries(['blunder', 'good', 'good', 'good', 'good'], 85);
    expect(s[0]).toBeLessThan(85);
    expect(s.at(-1)!).toBeGreaterThan(s[0]);
  });

  it('moodAt returns the demeanor before any move', () => {
    expect(moodAt([60, 70], 0, 80)).toBe(80);
    expect(moodAt([60, 70], 1, 80)).toBe(60);
    expect(moodAt([60, 70], 5, 80)).toBe(70);
  });

  it('buckets mood across the full range', () => {
    expect(moodBucket(90)).toBe('smitten');
    expect(moodBucket(70)).toBe('warm');
    expect(moodBucket(58)).toBe('pleased');
    expect(moodBucket(45)).toBe('neutral');
    expect(moodBucket(30)).toBe('cool');
    expect(moodBucket(10)).toBe('cold');
  });
});

describe('expressions', () => {
  it('maps standout classes to the right face', () => {
    expect(expressionFor('brilliant')).toBe('smitten');
    expect(expressionFor('blunder')).toBe('shocked');
    expect(expressionFor('miss')).toBe('wince');
  });

  it('drives the idle face from mood', () => {
    expect(restingExpression(90)).toBe('smitten');
    expect(restingExpression(10)).toBe('disappointed');
  });
});

describe('coachLine', () => {
  it('substitutes the SAN and is deterministic per ply', () => {
    const a = coachLine('blunder', 0, 'Qxh7');
    expect(a).toContain('Qxh7');
    expect(coachLine('blunder', 0, 'Qxh7')).toBe(a);
  });

  it('wraps the line bank and tolerates negative plies', () => {
    expect(() => coachLine('good', -3, 'e4')).not.toThrow();
    expect(coachLine('good', 0, 'e4')).toBe(coachLine('good', 3, 'e4'));
  });
});

describe('finalVerdict', () => {
  const counts = (over: Partial<Record<ReviewClass, number>> = {}) => ({
    brilliant: 0, great: 0, best: 0, excellent: 0, good: 0,
    inaccuracy: 0, miss: 0, mistake: 0, blunder: 0, ...over,
  });

  it('is warm and heart-marked when smitten, and cites accuracy', () => {
    const v = finalVerdict(90, 92.4, counts({ brilliant: 1 }));
    expect(v.title).toContain('♥');
    expect(v.line).toContain('92%');
    expect(v.line.toLowerCase()).toContain('brilliant');
  });

  it('is cold and dwells on blunders when the game went badly', () => {
    const v = finalVerdict(12, 61, counts({ blunder: 3 }));
    expect(v.title).toBe('Cold');
    expect(v.line).toContain('blunders');
  });
});
