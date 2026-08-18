/** Standard Elo. K=40 for a profile's first 30 rated games, then K=20; floor 100. */

export const RATING_FLOOR = 100;
export const DEFAULT_RATING = 1200;
export const PROVISIONAL_GAMES = 30;

export type Score = 0 | 0.5 | 1;

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + Math.pow(10, (opponent - rating) / 400));
}

export function kFactor(ratedGamesPlayed: number): number {
  return ratedGamesPlayed < PROVISIONAL_GAMES ? 40 : 20;
}

export function updatedRating(
  rating: number,
  opponent: number,
  score: Score,
  ratedGamesPlayed: number,
): number {
  const k = kFactor(ratedGamesPlayed);
  const next = rating + k * (score - expectedScore(rating, opponent));
  return Math.max(RATING_FLOOR, Math.round(next));
}
