import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ChessVariant, GameEndReason, GameResult } from '../chess/types';
import type { GameAnalysis } from '../engine/analysis';
import type { CheckersRules } from '../checkers/rules';

export interface Profile {
  id: string;
  name: string;
  avatarColor: string;
  createdAt: number;
  chess: RatingPool;
  checkers: RatingPool;
}

export interface RatingPool {
  rating: number;
  ratedGames: number;
  wins: number;
  losses: number;
  draws: number;
  peak: number;
  /** rating after each rated game, for the history chart */
  history: Array<{ t: number; rating: number }>;
  streak: number; // positive = win streak, negative = loss streak
}

export type PlayerRef =
  | { kind: 'profile'; profileId: string; name: string }
  | { kind: 'engine'; elo: number; name: string }
  | { kind: 'checkers-ai'; level: number; rating: number; name: string }
  | { kind: 'guest'; name: string };

export interface SavedGame {
  id: string;
  game: 'chess' | 'checkers';
  variant: ChessVariant | 'checkers';
  createdAt: number;
  finishedAt: number;
  white: PlayerRef;
  black: PlayerRef;
  result: GameResult;
  endReason: GameEndReason | string;
  rated: boolean;
  startFen: string;
  /** chess: uci moves; checkers: encoded from-to(xcaptures) strings */
  moves: string[];
  sans?: string[];
  pgn?: string;
  timeControl?: { base: number; inc: number } | null;
  analysis?: GameAnalysis | null;
  /** accuracy snapshot for library list display */
  accuracySummary?: { w: number; b: number } | null;
  checkersRules?: CheckersRules;
}

export interface BlunderPuzzle {
  id: string;
  gameId: string;
  profileId: string;
  createdAt: number;
  fen: string; // position before the blunder
  playedUci: string;
  bestUci: string;
  cpLoss: number;
  solved: number; // times solved
  attempts: number;
  lastResult?: 'solved' | 'failed';
}

interface GambitDB extends DBSchema {
  profiles: { key: string; value: Profile };
  games: {
    key: string;
    value: SavedGame;
    indexes: { 'by-finished': number; 'by-game': string };
  };
  puzzles: {
    key: string;
    value: BlunderPuzzle;
    indexes: { 'by-profile': string };
  };
  kv: { key: string; value: unknown };
}

export type Db = IDBPDatabase<GambitDB>;

let dbPromise: Promise<Db> | null = null;

export function db(): Promise<Db> {
  dbPromise ??= openDB<GambitDB>('gambitlab', 1, {
    upgrade(d) {
      d.createObjectStore('profiles', { keyPath: 'id' });
      const games = d.createObjectStore('games', { keyPath: 'id' });
      games.createIndex('by-finished', 'finishedAt');
      games.createIndex('by-game', 'game');
      const puzzles = d.createObjectStore('puzzles', { keyPath: 'id' });
      puzzles.createIndex('by-profile', 'profileId');
      d.createObjectStore('kv');
    },
  });
  return dbPromise;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function freshPool(rating = 1200): RatingPool {
  return {
    rating,
    ratedGames: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    peak: rating,
    history: [],
    streak: 0,
  };
}

// ------------------------------------------------------------------ kv utils

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key)) as T | undefined;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', value, key);
}
export async function kvDel(key: string): Promise<void> {
  await (await db()).delete('kv', key);
}

// ------------------------------------------------------------------- backup

export interface BackupBlob {
  version: 1;
  exportedAt: number;
  profiles: Profile[];
  games: SavedGame[];
  puzzles: BlunderPuzzle[];
  settings: unknown;
}

export async function exportBackup(): Promise<BackupBlob> {
  const d = await db();
  return {
    version: 1,
    exportedAt: Date.now(),
    profiles: await d.getAll('profiles'),
    games: await d.getAll('games'),
    puzzles: await d.getAll('puzzles'),
    settings: await d.get('kv', 'settings'),
  };
}

export async function importBackup(blob: BackupBlob): Promise<void> {
  if (blob.version !== 1) throw new Error('unsupported backup version');
  const d = await db();
  const tx = d.transaction(['profiles', 'games', 'puzzles', 'kv'], 'readwrite');
  for (const p of blob.profiles ?? []) await tx.objectStore('profiles').put(p);
  for (const g of blob.games ?? []) await tx.objectStore('games').put(g);
  for (const z of blob.puzzles ?? []) await tx.objectStore('puzzles').put(z);
  if (blob.settings !== undefined) await tx.objectStore('kv').put(blob.settings, 'settings');
  await tx.done;
}
