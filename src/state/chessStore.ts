import { create } from 'zustand';
import { VariantGame, type VariantGameOptions } from '../lib/chess/variantGame';
import type {
  ChessVariant,
  Color,
  GameOverState,
  RecordedMove,
  Square,
  UiMove,
} from '../lib/chess/types';
import { opposite } from '../lib/chess/types';
import { EnginePlayer } from '../lib/engine/enginePlayer';
import { scoreToCp } from '../lib/engine/analysis';
import { GameClock, type TimeControl } from '../lib/clock/clock';
import { getPlayEngine, withAnalysisEngine } from './engineHub';
import { kvDel, kvGet, kvSet, type PlayerRef } from '../lib/db/schema';
import {
  applyChessRatings,
  saveChessGame,
  startBackgroundAnalysis,
  type FinishChessGameInput,
} from '../lib/game/finish';
import { playSound } from '../lib/audio/sounds';
import { tapHaptic } from '../lib/platform/haptics';
import type { GameAnalysis } from '../lib/engine/analysis';

export type ChessMode = 'hve' | 'eve' | 'pvp';

export interface ChessGameConfig {
  mode: ChessMode;
  variant: ChessVariant;
  customFen?: string;
  seed?: number;
  /** fixed Chess960 start position (0-959); omit for random */
  position960?: number;
  rbcRatingGap?: number;
  /** hve: which color the human plays */
  humanColor?: Color;
  engineElo?: number; // hve
  eveElo?: { w: number; b: number }; // eve
  eveDelayMs?: number;
  timeControl?: TimeControl | null;
  rated?: boolean;
  white: PlayerRef;
  black: PlayerRef;
}

interface PendingPromotion {
  from: Square;
  to: Square;
}

export interface ChessState {
  status: 'idle' | 'playing' | 'paused' | 'over';
  config: ChessGameConfig | null;
  fen: string;
  turn: Color;
  lastMove: RecordedMove | null;
  checkSquare: Square | undefined;
  history: RecordedMove[];
  viewPly: number; // index into history for review scrolling; == history.length at live
  gameOver: GameOverState | null;
  clock: Record<Color, number> | null;
  lowTimeWarned: Record<Color, boolean>;
  pendingPromotion: PendingPromotion | null;
  premove: UiMove | null;
  hintMove: UiMove | null;
  hintsUsed: number;
  drawOffer: Color | null;
  engineThinking: boolean;
  /** live eval series, white POV cp; index i = after i plies */
  evals: number[];
  evalCp: number | null;
  analysisProgress: { done: number; total: number } | null;
  savedGameId: string | null;
  postAnalysis: GameAnalysis | null;

  newGame: (config: ChessGameConfig) => void;
  attemptMove: (from: Square, to: Square) => void;
  completePromotion: (piece: 'q' | 'r' | 'b' | 'n') => void;
  cancelPromotion: () => void;
  setPremove: (m: UiMove | null) => void;
  legalTargets: (from: Square) => UiMove[];
  resign: (side?: Color) => void;
  offerDraw: (side: Color) => void;
  respondDraw: (accept: boolean) => void;
  takeback: () => void;
  requestHint: () => void;
  goToPly: (ply: number) => void;
  pauseEve: () => void;
  resumeEve: () => void;
  stepEve: () => void;
  abort: () => void;
  resume: () => Promise<boolean>;
  reset: () => void;
}

// Non-reactive internals: class instances that must not live in React state.
let game: VariantGame | null = null;
let clock: GameClock | null = null;
let enginePlayers: Partial<Record<Color, EnginePlayer>> = {};
let eveTimer: ReturnType<typeof setTimeout> | null = null;
let moveToken = 0; // invalidates in-flight engine replies after reset/undo
let createdAt = 0;
let analysisAbort: AbortController | null = null;

export function currentGame(): VariantGame | null {
  return game;
}

const ACTIVE_KEY = 'activeChessGame';

interface ActiveSnapshot {
  config: ChessGameConfig;
  startFen: string;
  position960?: number;
  moves: string[];
  clock: Record<Color, number> | null;
  evals: number[];
  createdAt: number;
}

function snapshot(state: ChessState): void {
  if (!game || !state.config || state.status === 'over' || state.status === 'idle') return;
  const snap: ActiveSnapshot = {
    config: { ...state.config, customFen: game.startFen },
    startFen: game.startFen,
    position960: game.position960,
    moves: game.uciMoves(),
    clock: clock ? clock.snapshot() : null,
    evals: state.evals,
    createdAt,
  };
  void kvSet(ACTIVE_KEY, snap);
}

function gameOptions(config: ChessGameConfig): VariantGameOptions {
  return {
    variant: config.variant,
    fen: config.customFen,
    seed: config.seed,
    position960: config.position960,
    rbc:
      config.variant === 'rbc-handicap'
        ? { mode: 'handicap', ratingGap: config.rbcRatingGap ?? 0 }
        : config.variant === 'rbc-chaos'
          ? { mode: 'chaos' }
          : undefined,
  };
}

function engineSideOf(config: ChessGameConfig): Color | null {
  if (config.mode !== 'hve') return null;
  return opposite(config.humanColor ?? 'w');
}

export const useChess = create<ChessState>((set, get) => {
  function clearTimers() {
    if (eveTimer) {
      clearTimeout(eveTimer);
      eveTimer = null;
    }
  }

  function stopEverything() {
    moveToken++;
    clearTimers();
    clock?.stop();
    for (const p of Object.values(enginePlayers)) p?.stop();
  }

  function syncPosition(extra: Partial<ChessState> = {}) {
    if (!game) return;
    set({
      fen: game.fen(),
      turn: game.turn(),
      lastMove: game.lastMove() ?? null,
      checkSquare: game.checkedKingSquare(),
      history: [...game.history()],
      viewPly: game.history().length,
      ...extra,
    });
  }

  function finish(over: GameOverState) {
    stopEverything();
    const state = get();
    const config = state.config;
    set({ status: 'over', gameOver: over, engineThinking: false, premove: null });
    void kvDel(ACTIVE_KEY);
    playSound('gameend');
    if (!game || !config || !over.result || over.reason === 'abort') return;

    const input: FinishChessGameInput = {
      variant: config.variant,
      startFen: game.startFen,
      moves: game.history(),
      white: config.white,
      black: config.black,
      result: over.result,
      endReason: over.reason ?? 'agreement',
      rated: !!config.rated && config.variant === 'standard',
      timeControl: config.timeControl ?? null,
      createdAt,
    };
    void (async () => {
      await applyChessRatings(input);
      const id = await saveChessGame(input);
      set({ savedGameId: id });
      if (input.moves.length >= 4 && config.mode !== 'eve') {
        set({ analysisProgress: { done: 0, total: input.moves.length + 1 } });
        analysisAbort = startBackgroundAnalysis(
          id,
          input,
          (analysis) => set({ postAnalysis: analysis, analysisProgress: null }),
          (done, total) => set({ analysisProgress: { done, total } }),
        );
      }
    })();
  }

  function checkGameOver(): boolean {
    if (!game) return false;
    const over = game.gameOver();
    if (over.over) {
      finish(over);
      return true;
    }
    return false;
  }

  function afterMove(rec: RecordedMove) {
    playSound(rec.mate || rec.check ? 'check' : rec.captured ? 'capture' : 'move');
    tapHaptic(rec.captured ? 'medium' : 'light');
    clock?.press();
    syncPosition();
    snapshot(get());
    if (checkGameOver()) return;
    maybeScheduleEngine();
    maybeEvalPosition();
    tryPremove();
  }

  /** Background shallow eval for the eval bar (casual games only). */
  function maybeEvalPosition() {
    const { config, status } = get();
    if (!game || !config || status !== 'playing') return;
    if (config.rated || config.mode === 'eve') return; // EvE evals come from the players
    const token = moveToken;
    const fen = game.fen();
    const turn = game.turn();
    void withAnalysisEngine(async (engine) => {
      if (token !== moveToken) return;
      engine.setOption('MultiPV', 1);
      if (config.variant === 'chess960') engine.setOption('UCI_Chess960', true);
      engine.position(fen);
      const res = await engine.go({ depth: 10, movetime: 250 });
      if (token !== moveToken) return;
      const line = res.lines.get(1);
      if (!line) return;
      const cp = scoreToCp(line);
      const white = turn === 'w' ? cp : -cp;
      set((s) => ({ evalCp: white, evals: [...s.evals, white] }));
    });
  }

  function engineTurn(): Color | null {
    const { config, status } = get();
    if (!game || !config || status !== 'playing') return null;
    const turn = game.turn();
    if (config.mode === 'eve') return turn;
    if (config.mode === 'hve' && engineSideOf(config) === turn) return turn;
    return null;
  }

  function maybeScheduleEngine() {
    const side = engineTurn();
    if (side === null) return;
    const { config } = get();
    const delay = config?.mode === 'eve' ? (config.eveDelayMs ?? 600) : 120;
    const token = moveToken;
    clearTimers();
    eveTimer = setTimeout(() => {
      if (token === moveToken) void playEngineMove(side, token);
    }, delay);
  }

  async function playEngineMove(side: Color, token: number) {
    const { config } = get();
    if (!game || !config) return;
    const player = enginePlayers[side];
    if (!player) return;
    set({ engineThinking: true });
    try {
      const isEve = config.mode === 'eve';
      let lastInfoCp: number | null = null;
      const uci = await player.pickMove(game.startFen, game.uciMoves(), (info) => {
        if (info.multipv === 1) lastInfoCp = scoreToCp(info);
      });
      if (token !== moveToken || get().status !== 'playing') return;
      const rec = game.move(uci);
      set({ engineThinking: false });
      if (!rec) {
        // Engine produced a move we can't apply (shouldn't happen) — resign it.
        finish({
          over: true,
          result: side === 'w' ? '0-1' : '1-0',
          reason: 'resign',
          winner: opposite(side),
        });
        return;
      }
      if (isEve && lastInfoCp !== null) {
        const white = side === 'w' ? lastInfoCp : -lastInfoCp;
        set((s) => ({ evalCp: white, evals: [...s.evals, white] }));
      }
      afterMove(rec);
    } catch {
      set({ engineThinking: false });
    }
  }

  function tryPremove() {
    const { premove, config, status } = get();
    if (!premove || !game || !config || status !== 'playing') return;
    if (config.mode !== 'hve') return;
    const human = config.humanColor ?? 'w';
    if (game.turn() !== human) return;
    set({ premove: null });
    const rec = game.move(premove);
    if (rec) afterMove(rec);
  }

  function setupClock(config: ChessGameConfig) {
    clock = null;
    if (!config.timeControl) {
      set({ clock: null });
      return;
    }
    clock = new GameClock(
      config.timeControl,
      (rem) => {
        set({ clock: { w: rem.w, b: rem.b } });
        const warned = get().lowTimeWarned;
        for (const side of ['w', 'b'] as const) {
          if (!warned[side] && rem[side] > 0 && rem[side] < 15000) {
            set({ lowTimeWarned: { ...get().lowTimeWarned, [side]: true } });
            playSound('lowtime');
          }
        }
      },
      (side) => {
        if (!game) return;
        // Flag: opponent wins unless they cannot possibly mate.
        const winner = opposite(side);
        const insufficient = hasInsufficientMatingMaterial(winner);
        finish(
          insufficient
            ? { over: true, result: '1/2-1/2', reason: 'timeout-insufficient' }
            : {
                over: true,
                result: winner === 'w' ? '1-0' : '0-1',
                reason: 'timeout',
                winner,
              },
        );
      },
    );
    set({ clock: { w: config.timeControl.base * 1000, b: config.timeControl.base * 1000 } });
  }

  function hasInsufficientMatingMaterial(side: Color): boolean {
    if (!game) return false;
    // lone king, or king + single minor, cannot win on time
    const board = game.board().flat().filter(Boolean) as Array<{ color: Color; type: string }>;
    const mine = board.filter((p) => p.color === side && p.type !== 'k');
    if (mine.length === 0) return true;
    if (mine.length === 1 && (mine[0].type === 'b' || mine[0].type === 'n')) return true;
    return false;
  }

  function startEngines(config: ChessGameConfig) {
    enginePlayers = {};
    const engine = getPlayEngine();
    if (config.mode === 'hve') {
      const side = engineSideOf(config)!;
      enginePlayers[side] = new EnginePlayer(engine, config.engineElo ?? 1200);
    } else if (config.mode === 'eve') {
      enginePlayers.w = new EnginePlayer(engine, config.eveElo?.w ?? 1600);
      enginePlayers.b = new EnginePlayer(engine, config.eveElo?.b ?? 1600);
    }
    if (config.variant === 'chess960') {
      void engine.ready().then(() => engine.setOption('UCI_Chess960', true));
    } else {
      void engine.ready().then(() => engine.setOption('UCI_Chess960', false));
    }
  }

  function beginPlay(config: ChessGameConfig) {
    createdAt = Date.now();
    analysisAbort?.abort();
    analysisAbort = null;
    setupClock(config);
    startEngines(config);
    syncPosition({
      status: 'playing',
      config,
      gameOver: null,
      premove: null,
      hintMove: null,
      hintsUsed: 0,
      drawOffer: null,
      engineThinking: false,
      evals: [],
      evalCp: null,
      pendingPromotion: null,
      lowTimeWarned: { w: false, b: false },
      analysisProgress: null,
      savedGameId: null,
      postAnalysis: null,
    });
    clock?.start(game!.turn());
    snapshot(get());
    maybeScheduleEngine();
    maybeEvalPosition();
  }

  return {
    status: 'idle',
    config: null,
    fen: '',
    turn: 'w',
    lastMove: null,
    checkSquare: undefined,
    history: [],
    viewPly: 0,
    gameOver: null,
    clock: null,
    lowTimeWarned: { w: false, b: false },
    pendingPromotion: null,
    premove: null,
    hintMove: null,
    hintsUsed: 0,
    drawOffer: null,
    engineThinking: false,
    evals: [],
    evalCp: null,
    analysisProgress: null,
    savedGameId: null,
    postAnalysis: null,

    newGame: (config) => {
      stopEverything();
      game = new VariantGame(gameOptions(config));
      beginPlay(config);
    },

    attemptMove: (from, to) => {
      const state = get();
      if (!game || state.status !== 'playing') return;
      const config = state.config!;
      const turn = game.turn();

      // Whose pieces may the local user move?
      if (config.mode === 'hve') {
        const human = config.humanColor ?? 'w';
        if (turn !== human) {
          // queue premove if it's the engine's turn
          const piece = game.get(from);
          if (piece && piece.color === human) {
            set({ premove: { from, to } });
          }
          return;
        }
      } else if (config.mode === 'eve') {
        return;
      }

      if (game.needsPromotion(from, to)) {
        set({ pendingPromotion: { from, to } });
        return;
      }
      const rec = game.move({ from, to });
      if (!rec) {
        playSound('illegal');
        return;
      }
      set({ hintMove: null, drawOffer: null });
      afterMove(rec);
    },

    completePromotion: (piece) => {
      const { pendingPromotion } = get();
      if (!game || !pendingPromotion) return;
      const rec = game.move({ ...pendingPromotion, promotion: piece });
      set({ pendingPromotion: null });
      if (rec) afterMove(rec);
    },

    cancelPromotion: () => set({ pendingPromotion: null }),

    setPremove: (m) => set({ premove: m }),

    legalTargets: (from) => (game ? game.moves({ square: from }) : []),

    resign: (side) => {
      const state = get();
      if (state.status !== 'playing' || !state.config) return;
      const resigner =
        side ?? (state.config.mode === 'hve' ? (state.config.humanColor ?? 'w') : state.turn);
      finish({
        over: true,
        result: resigner === 'w' ? '0-1' : '1-0',
        reason: 'resign',
        winner: opposite(resigner),
      });
    },

    offerDraw: (side) => {
      const state = get();
      if (state.status !== 'playing' || !state.config) return;
      if (state.config.mode === 'hve') {
        // Engine accepts when it is clearly not better.
        const engineSide = engineSideOf(state.config)!;
        const evalWhite = state.evalCp ?? 0;
        const evalForEngine = engineSide === 'w' ? evalWhite : -evalWhite;
        if (evalForEngine <= -60) {
          finish({ over: true, result: '1/2-1/2', reason: 'agreement' });
        } else {
          set({ drawOffer: side });
          setTimeout(() => {
            if (get().drawOffer === side) set({ drawOffer: null });
          }, 1500);
        }
      } else {
        set({ drawOffer: side });
      }
    },

    respondDraw: (accept) => {
      const state = get();
      if (!state.drawOffer) return;
      if (accept) finish({ over: true, result: '1/2-1/2', reason: 'agreement' });
      else set({ drawOffer: null });
    },

    takeback: () => {
      const state = get();
      if (!game || state.status !== 'playing' || !state.config) return;
      if (state.config.rated) return; // casual only
      stopEverything();
      moveToken++;
      if (state.config.mode === 'hve') {
        const human = state.config.humanColor ?? 'w';
        // Undo back to the human's turn (1 or 2 plies).
        game.undo();
        if (game.turn() !== human) game.undo();
      } else {
        game.undo();
      }
      set({ premove: null, hintMove: null, engineThinking: false });
      syncPosition();
      snapshot(get());
      clock?.start(game.turn());
      maybeScheduleEngine();
    },

    requestHint: () => {
      const state = get();
      if (!game || state.status !== 'playing' || !state.config) return;
      if (state.config.rated || state.config.mode !== 'hve') return;
      const token = moveToken;
      const fen = game.fen();
      const is960 = state.config.variant === 'chess960';
      void withAnalysisEngine(async (engine) => {
        if (token !== moveToken) return;
        engine.setOption('MultiPV', 1);
        engine.setOption('UCI_Chess960', is960);
        engine.position(fen);
        const res = await engine.go({ depth: 14, movetime: 600 });
        if (token !== moveToken || !res.bestmove || res.bestmove.length < 4) return;
        set({
          hintMove: { from: res.bestmove.slice(0, 2), to: res.bestmove.slice(2, 4) },
          hintsUsed: get().hintsUsed + 1,
        });
      });
    },

    goToPly: (ply) => {
      const { history } = get();
      set({ viewPly: Math.max(0, Math.min(history.length, ply)) });
    },

    pauseEve: () => {
      const state = get();
      if (state.config?.mode !== 'eve' || state.status !== 'playing') return;
      moveToken++;
      clearTimers();
      for (const p of Object.values(enginePlayers)) p?.stop();
      clock?.pause();
      set({ status: 'paused', engineThinking: false });
    },

    resumeEve: () => {
      const state = get();
      if (state.config?.mode !== 'eve' || state.status !== 'paused') return;
      set({ status: 'playing' });
      clock?.start(game!.turn());
      maybeScheduleEngine();
    },

    stepEve: () => {
      const state = get();
      if (state.config?.mode !== 'eve' || state.status !== 'paused' || !game) return;
      const side = game.turn();
      const token = ++moveToken;
      set({ status: 'playing' });
      void playEngineMove(side, token).then(() => {
        const s = get();
        if (s.status === 'playing') {
          moveToken++;
          clearTimers();
          clock?.pause();
          set({ status: 'paused' });
        }
      });
    },

    abort: () => {
      const state = get();
      if (state.status !== 'playing' && state.status !== 'paused') return;
      stopEverything();
      set({ status: 'over', gameOver: { over: true, reason: 'abort' } });
      void kvDel(ACTIVE_KEY);
    },

    resume: async () => {
      const snap = await kvGet<ActiveSnapshot>(ACTIVE_KEY);
      if (!snap) return false;
      try {
        stopEverything();
        // A generated 960 game must be rebuilt from its position number:
        // its start FEN says castling '-' (VariantGame owns 960 rights), so
        // rebuilding from the FEN alone would lose the castling rights.
        // RBC games resume as 'custom' from the stored FEN (identical rules:
        // no castling); regenerating from the variant would reroll the armies.
        game =
          snap.config.variant === 'chess960'
            ? snap.position960 !== undefined
              ? new VariantGame({ variant: 'chess960', position960: snap.position960 })
              : new VariantGame({ variant: 'chess960', fen: snap.startFen })
            : snap.config.variant === 'standard'
              ? new VariantGame({ variant: 'standard' })
              : new VariantGame({ variant: 'custom', fen: snap.startFen });
        for (const uci of snap.moves) {
          if (!game.move(uci)) throw new Error(`bad snapshot move ${uci}`);
        }
        createdAt = snap.createdAt;
        analysisAbort?.abort();
        setupClock(snap.config);
        if (clock && snap.clock) {
          clock.restore(snap.clock);
          set({ clock: { ...snap.clock } });
        }
        startEngines(snap.config);
        syncPosition({
          status: 'playing',
          config: snap.config,
          gameOver: null,
          premove: null,
          hintMove: null,
          drawOffer: null,
          engineThinking: false,
          evals: snap.evals ?? [],
          evalCp: null,
          pendingPromotion: null,
          lowTimeWarned: { w: false, b: false },
          analysisProgress: null,
          savedGameId: null,
          postAnalysis: null,
          hintsUsed: 0,
        });
        if (checkGameOver()) return true;
        clock?.start(game.turn());
        maybeScheduleEngine();
        maybeEvalPosition();
        return true;
      } catch {
        void kvDel(ACTIVE_KEY);
        game = null;
        set({ status: 'idle' });
        return false;
      }
    },

    reset: () => {
      stopEverything();
      analysisAbort?.abort();
      game = null;
      set({
        status: 'idle',
        config: null,
        fen: '',
        history: [],
        viewPly: 0,
        gameOver: null,
        clock: null,
        premove: null,
        hintMove: null,
        pendingPromotion: null,
        evals: [],
        evalCp: null,
      });
    },
  };
});
