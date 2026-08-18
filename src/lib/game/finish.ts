import { db, newId, type BlunderPuzzle, type PlayerRef, type SavedGame } from '../db/schema';
import type { GameAnalysis } from '../engine/analysis';
import { analyzeGame } from '../engine/analysis';
import type { GameEndReason, GameResult, RecordedMove, ChessVariant } from '../chess/types';
import { exportPgn } from '../chess/pgn';
import { withAnalysisEngine } from '../../state/engineHub';
import { useProfiles } from '../../state/profilesStore';
import type { Score } from '../rating/elo';
import type { TimeControl } from '../clock/clock';

export interface FinishChessGameInput {
  variant: ChessVariant;
  startFen: string;
  moves: RecordedMove[];
  white: PlayerRef;
  black: PlayerRef;
  result: GameResult;
  endReason: GameEndReason;
  rated: boolean;
  timeControl: TimeControl | null;
  createdAt: number;
}

function scoreFor(result: GameResult, side: 'w' | 'b'): Score {
  if (result === '1/2-1/2') return 0.5;
  const whiteWon = result === '1-0';
  return (side === 'w') === whiteWon ? 1 : 0;
}

function ratingOf(ref: PlayerRef, pool: 'chess' | 'checkers'): number | undefined {
  if (ref.kind === 'engine') return ref.elo;
  if (ref.kind === 'checkers-ai') return ref.rating;
  if (ref.kind === 'profile') {
    const p = useProfiles.getState().byId(ref.profileId);
    return p ? p[pool].rating : undefined;
  }
  return undefined;
}

/**
 * Apply rating updates for a finished chess game. Engine ratings are fixed
 * published values and never change; profile ratings update per standard Elo.
 * Rated PvP updates both profiles (using pre-game ratings for both sides).
 */
export async function applyChessRatings(input: FinishChessGameInput): Promise<void> {
  if (!input.rated || input.variant !== 'standard') return;
  const { white, black } = input;
  const whiteRating = ratingOf(white, 'chess');
  const blackRating = ratingOf(black, 'chess');
  const profiles = useProfiles.getState();
  if (white.kind === 'profile' && blackRating !== undefined) {
    await profiles.applyRated(white.profileId, 'chess', blackRating, scoreFor(input.result, 'w'));
  }
  if (black.kind === 'profile' && whiteRating !== undefined) {
    await profiles.applyRated(black.profileId, 'chess', whiteRating, scoreFor(input.result, 'b'));
  }
}

/** Persist the finished game in the library. Returns the saved game id. */
export async function saveChessGame(input: FinishChessGameInput): Promise<string> {
  const id = newId();
  const pgn = exportPgn({
    startFen: input.startFen,
    variant: input.variant,
    moves: input.moves,
    result: input.result,
    headers: {
      white: input.white.name,
      black: input.black.name,
      timeControl: input.timeControl
        ? `${input.timeControl.base}+${input.timeControl.inc}`
        : undefined,
    },
  });
  const saved: SavedGame = {
    id,
    game: 'chess',
    variant: input.variant,
    createdAt: input.createdAt,
    finishedAt: Date.now(),
    white: input.white,
    black: input.black,
    result: input.result,
    endReason: input.endReason,
    rated: input.rated,
    startFen: input.startFen,
    moves: input.moves.map((m) => m.uci),
    sans: input.moves.map((m) => m.san),
    pgn,
    timeControl: input.timeControl,
    analysis: null,
    accuracySummary: null,
  };
  await (await db()).put('games', saved);
  return id;
}

const BLUNDER_PUZZLE_MIN_CPLOSS = 250;

/**
 * Post-game background analysis: evaluates the whole game on the analysis
 * engine, stores the report on the saved game, and mints Blunder Redo puzzles
 * from each profile player's blunders. Cancel via the returned controller.
 */
export function startBackgroundAnalysis(
  gameId: string,
  input: FinishChessGameInput,
  onDone?: (analysis: GameAnalysis) => void,
  onProgress?: (done: number, total: number) => void,
): AbortController {
  const controller = new AbortController();
  void withAnalysisEngine(async (engine) => {
    const analysis = await analyzeGame(engine, input.startFen, input.moves, {
      depth: 12,
      signal: controller.signal,
      chess960: input.variant === 'chess960',
      onProgress,
    });
    if (!analysis) return;
    const d = await db();
    const saved = await d.get('games', gameId);
    if (saved) {
      saved.analysis = analysis;
      saved.accuracySummary = analysis.accuracy;
      await d.put('games', saved);
    }
    await mintBlunderPuzzles(gameId, input, analysis);
    onDone?.(analysis);
  }).catch(() => {});
  return controller;
}

async function mintBlunderPuzzles(
  gameId: string,
  input: FinishChessGameInput,
  analysis: GameAnalysis,
): Promise<void> {
  const d = await db();
  for (let i = 0; i < analysis.moves.length; i++) {
    const m = analysis.moves[i];
    if (m.class !== 'blunder' || m.cpLoss < BLUNDER_PUZZLE_MIN_CPLOSS || !m.bestUci) continue;
    const mover = input.moves[i].color;
    const ref = mover === 'w' ? input.white : input.black;
    if (ref.kind !== 'profile') continue;
    const puzzle: BlunderPuzzle = {
      id: newId(),
      gameId,
      profileId: ref.profileId,
      createdAt: Date.now(),
      fen: input.moves[i].fenBefore,
      playedUci: input.moves[i].uci,
      bestUci: m.bestUci,
      cpLoss: m.cpLoss,
      solved: 0,
      attempts: 0,
    };
    await d.put('puzzles', puzzle);
  }
}
