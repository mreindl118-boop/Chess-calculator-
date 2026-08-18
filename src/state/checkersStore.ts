import { create } from 'zustand';
import {
  applyMove,
  boardKey,
  gameOverState,
  initialBoard,
  isProgressMove,
  legalMoves,
  opponent,
  DEFAULT_RULES,
  type Board,
  type CheckersColor,
  type CheckersMove,
  type CheckersRules,
} from '../lib/checkers/rules';
import { checkersLevel, type CheckersLevel } from '../lib/checkers/engine';
import type { CheckersWorkerRequest, CheckersWorkerResponse } from '../workers/checkers.worker';
import { db, kvDel, kvGet, kvSet, newId, type PlayerRef, type SavedGame } from '../lib/db/schema';
import { useProfiles } from './profilesStore';
import { GameClock, type TimeControl } from '../lib/clock/clock';
import { playSound } from '../lib/audio/sounds';
import { tapHaptic } from '../lib/platform/haptics';
import type { Score } from '../lib/rating/elo';

export type CheckersMode = 'hva' | 'ava' | 'pvp';

export interface CheckersGameConfig {
  mode: CheckersMode;
  rules: CheckersRules;
  humanColor?: CheckersColor; // hva
  aiLevel?: number; // hva
  avaLevels?: { w: number; b: number };
  avaDelayMs?: number;
  timeControl?: TimeControl | null;
  rated?: boolean;
  white: PlayerRef;
  black: PlayerRef;
}

export interface CheckersOverState {
  over: boolean;
  winner?: CheckersColor;
  draw?: boolean;
  reason?: string;
}

interface CheckersState {
  status: 'idle' | 'playing' | 'paused' | 'over';
  config: CheckersGameConfig | null;
  board: number[]; // rendered copy
  turn: CheckersColor;
  selected: number | null;
  legal: CheckersMove[];
  lastMove: CheckersMove | null;
  moveLog: string[];
  gameOver: CheckersOverState | null;
  clock: Record<CheckersColor, number> | null;
  aiThinking: boolean;
  savedGameId: string | null;

  newGame: (config: CheckersGameConfig) => void;
  select: (sq: number | null) => void;
  tryMove: (from: number, to: number) => void;
  resign: (side?: CheckersColor) => void;
  pauseAva: () => void;
  resumeAva: () => void;
  abort: () => void;
  resume: () => Promise<boolean>;
  reset: () => void;
}

let board: Board = initialBoard();
let clock: GameClock | null = null;
let worker: Worker | null = null;
let requestId = 0;
let moveToken = 0;
let aiTimer: ReturnType<typeof setTimeout> | null = null;
let createdAt = 0;
let progressPlies = 0;
let repCounts = new Map<string, number>();
let moveHistory: CheckersMove[] = [];

const ACTIVE_KEY = 'activeCheckersGame';

interface CheckersSnapshot {
  config: CheckersGameConfig;
  board: number[];
  turn: CheckersColor;
  moveLog: string[];
  moves: Array<{ from: number; to: number }>;
  clock: Record<CheckersColor, number> | null;
  progressPlies: number;
  createdAt: number;
}

function encodeMove(m: CheckersMove): string {
  const sep = m.captures.length > 0 ? 'x' : '-';
  return [m.from + 1, ...m.path.map((p) => p + 1)].join(sep);
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/checkers.worker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return worker;
}

function searchInWorker(
  b: Board,
  toMove: CheckersColor,
  level: CheckersLevel,
  rules: CheckersRules,
): Promise<CheckersWorkerResponse> {
  return new Promise((resolve) => {
    const w = getWorker();
    const id = ++requestId;
    const handler = (e: MessageEvent<CheckersWorkerResponse>) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', handler);
      resolve(e.data);
    };
    w.addEventListener('message', handler);
    const req: CheckersWorkerRequest = {
      id,
      board: Array.from(b),
      toMove,
      params: { ...level.params, rules },
    };
    w.postMessage(req);
  });
}

export const useCheckers = create<CheckersState>((set, get) => {
  function stopEverything() {
    moveToken++;
    if (aiTimer) {
      clearTimeout(aiTimer);
      aiTimer = null;
    }
    clock?.stop();
  }

  function sync(extra: Partial<CheckersState> = {}) {
    const cfg = get().config;
    set({
      board: Array.from(board),
      legal: cfg ? legalMoves(board, get().turn, cfg.rules) : [],
      ...extra,
    });
  }

  function snapshot() {
    const s = get();
    if (!s.config || s.status === 'over' || s.status === 'idle') return;
    const snap: CheckersSnapshot = {
      config: s.config,
      board: Array.from(board),
      turn: s.turn,
      moveLog: s.moveLog,
      moves: moveHistory.map((m) => ({ from: m.from, to: m.to })),
      clock: clock ? clock.snapshot() : null,
      progressPlies,
      createdAt,
    };
    void kvSet(ACTIVE_KEY, snap);
  }

  function ratingRefOf(ref: PlayerRef): number | undefined {
    if (ref.kind === 'checkers-ai') return ref.rating;
    if (ref.kind === 'profile') {
      const p = useProfiles.getState().byId(ref.profileId);
      return p?.checkers.rating;
    }
    return undefined;
  }

  function finish(over: CheckersOverState) {
    stopEverything();
    const s = get();
    set({ status: 'over', gameOver: over, aiThinking: false });
    void kvDel(ACTIVE_KEY);
    playSound('gameend');
    const config = s.config;
    if (!config || over.reason === 'abort') return;

    const result = over.draw ? '1/2-1/2' : over.winner === 'w' ? '1-0' : '0-1';
    void (async () => {
      if (config.rated) {
        const wR = ratingRefOf(config.white);
        const bR = ratingRefOf(config.black);
        const profiles = useProfiles.getState();
        const scoreW: Score = over.draw ? 0.5 : over.winner === 'w' ? 1 : 0;
        if (config.white.kind === 'profile' && bR !== undefined) {
          await profiles.applyRated(config.white.profileId, 'checkers', bR, scoreW);
        }
        if (config.black.kind === 'profile' && wR !== undefined) {
          await profiles.applyRated(
            config.black.profileId,
            'checkers',
            wR,
            (1 - scoreW) as Score,
          );
        }
      }
      const saved: SavedGame = {
        id: newId(),
        game: 'checkers',
        variant: 'checkers',
        createdAt,
        finishedAt: Date.now(),
        white: config.white,
        black: config.black,
        result,
        endReason: over.reason ?? 'unknown',
        rated: !!config.rated,
        startFen: '',
        moves: get().moveLog,
        timeControl: config.timeControl ?? null,
        checkersRules: config.rules,
      };
      await (await db()).put('games', saved);
      set({ savedGameId: saved.id });
    })();
  }

  function checkOver(): boolean {
    const s = get();
    const rules = s.config?.rules ?? DEFAULT_RULES;
    const key = boardKey(board, s.turn);
    const reps = repCounts.get(key) ?? 0;
    const over = gameOverState(board, s.turn, rules, progressPlies, reps);
    if (over.over) {
      finish(over);
      return true;
    }
    return false;
  }

  function aiSide(): CheckersColor | null {
    const s = get();
    if (!s.config || s.status !== 'playing') return null;
    if (s.config.mode === 'ava') return s.turn;
    if (s.config.mode === 'hva' && s.turn !== (s.config.humanColor ?? 'w')) return s.turn;
    return null;
  }

  function maybeScheduleAi() {
    const side = aiSide();
    if (side === null) return;
    const s = get();
    const delay = s.config?.mode === 'ava' ? (s.config.avaDelayMs ?? 700) : 250;
    const token = moveToken;
    if (aiTimer) clearTimeout(aiTimer);
    aiTimer = setTimeout(() => {
      if (token !== moveToken) return;
      void playAiMove(side, token);
    }, delay);
  }

  async function playAiMove(side: CheckersColor, token: number) {
    const s = get();
    const config = s.config;
    if (!config) return;
    const levelNum =
      config.mode === 'ava'
        ? (side === 'w' ? config.avaLevels?.w : config.avaLevels?.b) ?? 3
        : (config.aiLevel ?? 3);
    const level = checkersLevel(levelNum);
    set({ aiThinking: true });
    const res = await searchInWorker(board, side, level, config.rules);
    if (token !== moveToken || get().status !== 'playing') return;
    set({ aiThinking: false });
    if (!res.move) {
      finish({ over: true, winner: opponent(side), reason: 'no-moves' });
      return;
    }
    executeMove(res.move);
  }

  function executeMove(move: CheckersMove) {
    const s = get();
    progressPlies = isProgressMove(board, move) ? 0 : progressPlies + 1;
    board = applyMove(board, move);
    moveHistory.push(move);
    const nextTurn = opponent(s.turn);
    const key = boardKey(board, nextTurn);
    repCounts.set(key, (repCounts.get(key) ?? 0) + 1);
    playSound(move.captures.length > 0 ? 'capture' : 'move');
    tapHaptic(move.captures.length > 0 ? 'medium' : 'light');
    clock?.press();
    set({
      turn: nextTurn,
      lastMove: move,
      selected: null,
      moveLog: [...s.moveLog, encodeMove(move)],
    });
    sync();
    snapshot();
    if (checkOver()) return;
    maybeScheduleAi();
  }

  function setupClock(config: CheckersGameConfig) {
    clock = null;
    if (!config.timeControl) {
      set({ clock: null });
      return;
    }
    clock = new GameClock(
      config.timeControl,
      (rem) => set({ clock: { ...rem } }),
      (side) => finish({ over: true, winner: opponent(side), reason: 'timeout' }),
    );
    set({ clock: { w: config.timeControl.base * 1000, b: config.timeControl.base * 1000 } });
  }

  return {
    status: 'idle',
    config: null,
    board: Array.from(initialBoard()),
    turn: 'w',
    selected: null,
    legal: [],
    lastMove: null,
    moveLog: [],
    gameOver: null,
    clock: null,
    aiThinking: false,
    savedGameId: null,

    newGame: (config) => {
      stopEverything();
      board = initialBoard();
      repCounts = new Map();
      moveHistory = [];
      progressPlies = 0;
      createdAt = Date.now();
      setupClock(config);
      set({
        status: 'playing',
        config,
        turn: 'w',
        selected: null,
        lastMove: null,
        moveLog: [],
        gameOver: null,
        aiThinking: false,
        savedGameId: null,
      });
      sync();
      repCounts.set(boardKey(board, 'w'), 1);
      clock?.start('w');
      snapshot();
      maybeScheduleAi();
    },

    select: (sq) => set({ selected: sq }),

    tryMove: (from, to) => {
      const s = get();
      if (s.status !== 'playing' || !s.config) return;
      if (s.config.mode === 'ava') return;
      if (s.config.mode === 'hva' && s.turn !== (s.config.humanColor ?? 'w')) return;
      const candidates = s.legal.filter((m) => m.from === from && m.to === to);
      if (candidates.length === 0) {
        playSound('illegal');
        set({ selected: null });
        return;
      }
      // If several capture sequences share from/to, prefer the longest.
      const move = candidates.sort((a, b) => b.captures.length - a.captures.length)[0];
      executeMove(move);
    },

    resign: (side) => {
      const s = get();
      if (s.status !== 'playing' || !s.config) return;
      const resigner = side ?? (s.config.mode === 'hva' ? (s.config.humanColor ?? 'w') : s.turn);
      finish({ over: true, winner: opponent(resigner), reason: 'resign' });
    },

    pauseAva: () => {
      const s = get();
      if (s.config?.mode !== 'ava' || s.status !== 'playing') return;
      moveToken++;
      if (aiTimer) clearTimeout(aiTimer);
      clock?.pause();
      set({ status: 'paused', aiThinking: false });
    },

    resumeAva: () => {
      const s = get();
      if (s.config?.mode !== 'ava' || s.status !== 'paused') return;
      set({ status: 'playing' });
      clock?.start(s.turn);
      maybeScheduleAi();
    },

    abort: () => {
      stopEverything();
      set({ status: 'over', gameOver: { over: true, reason: 'abort' } });
      void kvDel(ACTIVE_KEY);
    },

    resume: async () => {
      const snap = await kvGet<CheckersSnapshot>(ACTIVE_KEY);
      if (!snap) return false;
      try {
        stopEverything();
        board = new Int8Array(snap.board);
        repCounts = new Map();
        moveHistory = [];
        progressPlies = snap.progressPlies;
        createdAt = snap.createdAt;
        setupClock(snap.config);
        if (clock && snap.clock) {
          clock.restore(snap.clock);
          set({ clock: { ...snap.clock } });
        }
        set({
          status: 'playing',
          config: snap.config,
          turn: snap.turn,
          selected: null,
          lastMove: null,
          moveLog: snap.moveLog,
          gameOver: null,
          aiThinking: false,
          savedGameId: null,
        });
        sync();
        repCounts.set(boardKey(board, snap.turn), 1);
        if (checkOver()) return true;
        clock?.start(snap.turn);
        maybeScheduleAi();
        return true;
      } catch {
        void kvDel(ACTIVE_KEY);
        set({ status: 'idle' });
        return false;
      }
    },

    reset: () => {
      stopEverything();
      board = initialBoard();
      set({
        status: 'idle',
        config: null,
        board: Array.from(board),
        turn: 'w',
        selected: null,
        legal: [],
        lastMove: null,
        moveLog: [],
        gameOver: null,
        clock: null,
        savedGameId: null,
      });
    },
  };
});
