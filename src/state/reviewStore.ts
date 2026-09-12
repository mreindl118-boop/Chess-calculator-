import { create } from 'zustand';
import { importPgn } from '../lib/chess/pgn';
import type { ChessVariant, RecordedMove } from '../lib/chess/types';
import { START_FEN } from '../lib/chess/types';
import { withAnalysisEngine } from './engineHub';
import { reviewGame, type GameReview } from '../lib/engine/review';

export interface LoadedGame {
  startFen: string;
  variant: ChessVariant;
  moves: RecordedMove[];
  headers: Record<string, string>;
  result?: string;
}

interface ReviewState {
  pgnText: string;
  error: string | null;
  game: LoadedGame | null;
  review: GameReview | null;
  running: boolean;
  progress: { done: number; total: number } | null;
  /** number of moves applied to the board: 0 = start, n = final position */
  viewPly: number;
  controller: AbortController | null;

  setPgn: (text: string) => void;
  run: (pgn?: string) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  goToPly: (ply: number) => void;
  next: () => void;
  prev: () => void;
  toStart: () => void;
  toEnd: () => void;
}

export const useReview = create<ReviewState>((set, get) => ({
  pgnText: '',
  error: null,
  game: null,
  review: null,
  running: false,
  progress: null,
  viewPly: 0,
  controller: null,

  setPgn: (text) => set({ pgnText: text, error: null }),

  run: async (pgn) => {
    const text = (pgn ?? get().pgnText).trim();
    if (!text) {
      set({ error: 'Paste a PGN to review.' });
      return;
    }
    get().controller?.abort();

    let game: LoadedGame;
    try {
      const imported = importPgn(text);
      if (imported.moves.length === 0) throw new Error('No moves found in that PGN.');
      game = {
        startFen: imported.startFen,
        variant: imported.variant,
        moves: imported.moves,
        headers: imported.headers,
        result: imported.result,
      };
    } catch (e) {
      set({
        error: e instanceof Error ? `Could not read that PGN: ${e.message}` : 'Could not read that PGN.',
        game: null,
        review: null,
      });
      return;
    }

    const controller = new AbortController();
    set({
      pgnText: text,
      game,
      review: null,
      error: null,
      running: true,
      progress: { done: 0, total: game.moves.length + 1 },
      viewPly: 0,
      controller,
    });

    try {
      const review = await withAnalysisEngine((engine) =>
        reviewGame(engine, game.startFen, game.moves, {
          depth: 14,
          signal: controller.signal,
          chess960: game.variant === 'chess960',
          onProgress: (done, total) => set({ progress: { done, total } }),
        }),
      );
      if (controller.signal.aborted) return;
      if (!review) {
        set({ running: false, progress: null, error: 'Review was cancelled.' });
        return;
      }
      set({ review, running: false, progress: null, viewPly: 0 });
    } catch (e) {
      if (controller.signal.aborted) return;
      set({
        running: false,
        progress: null,
        error: e instanceof Error ? `Review failed: ${e.message}` : 'Review failed.',
      });
    }
  },

  cancel: () => {
    get().controller?.abort();
    set({ running: false, progress: null, controller: null });
  },

  reset: () => {
    get().controller?.abort();
    set({
      pgnText: '',
      error: null,
      game: null,
      review: null,
      running: false,
      progress: null,
      viewPly: 0,
      controller: null,
    });
  },

  goToPly: (ply) => {
    const g = get().game;
    const max = g ? g.moves.length : 0;
    set({ viewPly: Math.max(0, Math.min(max, ply)) });
  },
  next: () => get().goToPly(get().viewPly + 1),
  prev: () => get().goToPly(get().viewPly - 1),
  toStart: () => get().goToPly(0),
  toEnd: () => get().goToPly(get().game?.moves.length ?? 0),
}));

/** Board FEN for the currently viewed ply. */
export function fenAtPly(game: LoadedGame | null, ply: number): string {
  if (!game) return START_FEN;
  if (ply <= 0) return game.startFen;
  return game.moves[Math.min(ply, game.moves.length) - 1].fenAfter;
}
