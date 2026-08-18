/**
 * The whole engine-strength ladder lives here: one function maps a target Elo
 * to concrete engine settings, so every rung can be tuned in one place.
 *
 * - target >= 1320 (Stockfish's UCI_Elo floor): UCI_LimitStrength + UCI_Elo.
 * - target < 1320: Skill Level 0-5, hard depth/node caps, and a MultiPV
 *   random-choice blend weighted toward weaker moves as the target drops, so
 *   ~250 is genuinely beatable by a beginner.
 */

export const MIN_ELO = 250;
export const MAX_ELO = 3200;
export const UCI_ELO_FLOOR = 1320;
export const UCI_ELO_CEIL = 3190;

export interface BlendSettings {
  /** number of candidate lines to sample from */
  multipv: number;
  /** geometric weight ratio between candidate i and i+1 (lower = more random) */
  temperature: number;
  /** candidates worse than best by more than this (cp) are never picked */
  maxCpLoss: number;
}

export interface EloSettings {
  elo: number;
  /** engine plays at full strength limited by UCI_Elo */
  uciElo?: number;
  /** Stockfish Skill Level (only for sub-1320 targets) */
  skill?: number;
  depthCap?: number;
  nodesCap?: number;
  blend?: BlendSettings;
  movetime: number;
}

export interface EngineRung {
  name: string;
  elo: number;
}

/** Named rungs surfaced on the strength slider. */
export const ENGINE_RUNGS: EngineRung[] = [
  { name: 'Beginner', elo: 400 },
  { name: 'Casual', elo: 800 },
  { name: 'Club', elo: 1200 },
  { name: 'Strong', elo: 1600 },
  { name: 'Expert', elo: 2000 },
  { name: 'Master', elo: 2400 },
  { name: 'Max', elo: MAX_ELO },
];

export function rungName(elo: number): string {
  let best = ENGINE_RUNGS[0];
  for (const r of ENGINE_RUNGS) {
    if (Math.abs(r.elo - elo) < Math.abs(best.elo - elo)) best = r;
  }
  return Math.abs(best.elo - elo) <= 100 ? best.name : `Elo ${elo}`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function settingsForElo(target: number): EloSettings {
  const elo = Math.round(Math.min(MAX_ELO, Math.max(MIN_ELO, target)));

  if (elo >= MAX_ELO) {
    // Max: no strength limit, just a decent think.
    return { elo, movetime: 1500 };
  }

  if (elo >= UCI_ELO_FLOOR) {
    const t = (elo - UCI_ELO_FLOOR) / (MAX_ELO - UCI_ELO_FLOOR);
    return {
      elo,
      uciElo: Math.min(UCI_ELO_CEIL, elo),
      movetime: Math.round(lerp(400, 1200, t)),
    };
  }

  // 250 .. 1319: skill + caps + blend.
  const t = (elo - MIN_ELO) / (UCI_ELO_FLOOR - MIN_ELO); // 0 at 250, ~1 at 1320
  return {
    elo,
    skill: Math.min(5, Math.round(t * 5)),
    depthCap: Math.max(1, Math.round(lerp(1, 8, t))),
    nodesCap: Math.round(lerp(400, 60000, t * t)),
    blend: {
      multipv: Math.round(lerp(8, 3, t)),
      // ~0.92 at 250 Elo (nearly uniform over 8 weak-depth candidates) down
      // to ~0.35 at 1300 (mostly the best move).
      temperature: lerp(0.92, 0.35, t),
      maxCpLoss: Math.round(lerp(900, 150, t)),
    },
    movetime: Math.round(lerp(120, 400, t)),
  };
}

/** Fixed published rating used by the rating system for a given engine level. */
export function publishedEngineRating(elo: number): number {
  return Math.round(Math.min(MAX_ELO, Math.max(MIN_ELO, elo)));
}
