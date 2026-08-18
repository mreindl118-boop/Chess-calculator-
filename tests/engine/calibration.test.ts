import { describe, expect, it } from 'vitest';
import {
  ENGINE_RUNGS,
  MAX_ELO,
  MIN_ELO,
  UCI_ELO_FLOOR,
  publishedEngineRating,
  rungName,
  settingsForElo,
} from '../../src/lib/engine/calibration';
import { expectedScore, kFactor, updatedRating, RATING_FLOOR } from '../../src/lib/rating/elo';

describe('elo ladder calibration', () => {
  it('clamps to the supported range', () => {
    expect(settingsForElo(1).elo).toBe(MIN_ELO);
    expect(settingsForElo(99999).elo).toBe(MAX_ELO);
  });

  it('uses UCI_Elo at and above the floor', () => {
    for (const elo of [UCI_ELO_FLOOR, 1600, 2400, 3000]) {
      const s = settingsForElo(elo);
      expect(s.uciElo).toBe(elo);
      expect(s.skill).toBeUndefined();
      expect(s.blend).toBeUndefined();
    }
  });

  it('max rung plays unrestricted', () => {
    const s = settingsForElo(MAX_ELO);
    expect(s.uciElo).toBeUndefined();
    expect(s.skill).toBeUndefined();
  });

  it('sub-floor targets get skill + caps + blend, weaker as elo drops', () => {
    const low = settingsForElo(250);
    const mid = settingsForElo(800);
    const high = settingsForElo(1300);
    for (const s of [low, mid, high]) {
      expect(s.uciElo).toBeUndefined();
      expect(s.skill).toBeDefined();
      expect(s.depthCap).toBeGreaterThanOrEqual(1);
      expect(s.nodesCap).toBeGreaterThan(0);
      expect(s.blend).toBeDefined();
    }
    expect(low.skill!).toBeLessThanOrEqual(mid.skill!);
    expect(low.depthCap!).toBeLessThan(high.depthCap!);
    expect(low.nodesCap!).toBeLessThan(high.nodesCap!);
    expect(low.blend!.multipv).toBeGreaterThan(high.blend!.multipv);
    expect(low.blend!.temperature).toBeGreaterThan(high.blend!.temperature);
    expect(low.blend!.maxCpLoss).toBeGreaterThan(high.blend!.maxCpLoss);
  });

  it('has the documented named rungs', () => {
    expect(ENGINE_RUNGS.map((r) => r.name)).toEqual([
      'Beginner', 'Casual', 'Club', 'Strong', 'Expert', 'Master', 'Max',
    ]);
    expect(rungName(400)).toBe('Beginner');
    expect(rungName(3200)).toBe('Max');
    expect(rungName(1000)).toBe('Elo 1000');
  });

  it('published engine ratings equal the clamped target', () => {
    expect(publishedEngineRating(400)).toBe(400);
    expect(publishedEngineRating(5000)).toBe(MAX_ELO);
  });
});

describe('elo rating updates', () => {
  it('expected score is 0.5 for equals and sums to 1', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5);
    expect(expectedScore(1600, 1400) + expectedScore(1400, 1600)).toBeCloseTo(1);
  });

  it('K is 40 for the first 30 games, then 20', () => {
    expect(kFactor(0)).toBe(40);
    expect(kFactor(29)).toBe(40);
    expect(kFactor(30)).toBe(20);
  });

  it('winning gains, losing drops, floor holds', () => {
    expect(updatedRating(1200, 1200, 1, 0)).toBe(1220);
    expect(updatedRating(1200, 1200, 0, 50)).toBe(1190);
    expect(updatedRating(105, 105, 0, 50)).toBe(RATING_FLOOR);
  });

  it('beating a much stronger opponent pays more', () => {
    const vsStrong = updatedRating(1200, 2000, 1, 50) - 1200;
    const vsWeak = updatedRating(1200, 800, 1, 50) - 1200;
    expect(vsStrong).toBeGreaterThan(vsWeak);
  });
});
