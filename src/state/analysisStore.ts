import { create } from 'zustand';
import { MoveTree, type TreeNode } from '../lib/chess/moveTree';
import { VariantGame } from '../lib/chess/variantGame';
import { START_FEN, type ChessVariant, type PieceSymbol, type Square } from '../lib/chess/types';
import { getAnalysisEngineRaw, withAnalysisEngine } from './engineHub';
import type { EngineInfo } from '../lib/engine/uci';
import { exportPgn, importPgn } from '../lib/chess/pgn';
import { db } from '../lib/db/schema';
import { classify, scoreToCp, type GameAnalysis, type MoveClass } from '../lib/engine/analysis';

/** Live grade of the move the user just played, versus the engine's best. */
export interface MoveVerdict {
  san: string;
  playedUci: string;
  bestSan: string;
  bestUci: string;
  /** centipawns thrown away versus the best move (mover's perspective) */
  cpLoss: number;
  cls: MoveClass;
  /** depth of the after-position search this verdict is based on */
  depth: number;
  final: boolean;
}

interface PendingVerdict {
  /** fen AFTER the played move — verdict resolves when this position's search deepens */
  forFen: string;
  bestUci: string;
  bestSan: string;
  /** best eval of the pre-move position, mover's POV (cp) */
  bestScoreCp: number;
  playedUci: string;
  playedSan: string;
}

export interface AnalysisState {
  rootFen: string;
  variant: ChessVariant;
  currentNodeId: number;
  fen: string;
  /** bumped whenever the tree structure changes, to re-render the tree view */
  treeVersion: number;
  engineOn: boolean;
  lines: EngineInfo[];
  /** the three worst legal moves (from a quick full-width ranking pass) */
  worstLines: EngineInfo[];
  depth: number;
  editing: boolean;
  loadedGameAnalysis: GameAnalysis | null;
  loadedGameId: string | null;
  error: string | null;
  /** grade of the last move played on the board, once computed */
  verdict: MoveVerdict | null;

  setRoot: (fen: string, variant?: ChessVariant) => void;
  tryMove: (from: Square, to: Square, promotion?: PieceSymbol) => boolean;
  needsPromotion: (from: Square, to: Square) => boolean;
  goto: (nodeId: number) => void;
  back: () => void;
  forward: () => void;
  promoteVariation: (nodeId: number) => void;
  deleteVariation: (nodeId: number) => void;
  toggleEngine: () => void;
  loadPgnText: (pgn: string) => boolean;
  exportPgnText: () => string;
  loadSavedGame: (gameId: string) => Promise<boolean>;
  setEditing: (on: boolean) => void;
  legalTargets: (from: Square) => ReturnType<VariantGame['moves']>;
  stopEngine: () => void;
}

let tree = new MoveTree(START_FEN);
let searchGeneration = 0;
/** Depth of the quick full-width pass that ranks the worst moves. */
const WORST_SCAN_DEPTH = 12;
/** Minimum gap between committed best-move updates, to keep the list calm. */
const FLUSH_MS = 350;
/** Two moves within this many centipawns keep their existing rank (no swap). */
const ORDER_HYSTERESIS = 30;
let pendingVerdict: PendingVerdict | null = null;

export function analysisTree(): MoveTree {
  return tree;
}

function gameAt(fen: string, variant: ChessVariant): VariantGame | null {
  try {
    if (variant === 'chess960') return new VariantGame({ variant: 'chess960', fen });
    return new VariantGame({ variant: 'custom', fen });
  } catch {
    return null;
  }
}

export const useAnalysis = create<AnalysisState>((set, get) => {
  async function runEngine(): Promise<void> {
    const generation = ++searchGeneration;
    const { engineOn, fen, variant } = get();
    getAnalysisEngineRaw().stop();
    if (!engineOn) return;
    const legalCount = gameAt(fen, variant)?.moves().length ?? 3;
    await withAnalysisEngine(async (engine) => {
      if (generation !== searchGeneration) return;
      engine.setOption('UCI_LimitStrength', false);
      engine.setOption('Skill Level', 20);
      engine.setOption('UCI_Chess960', variant === 'chess960');
      engine.position(fen);

      // Phase 1 — rank EVERY legal move to a shallow depth. This is fast and
      // finds the worst moves (blunders show early), without the deep-search
      // depth penalty a permanently wide MultiPV would impose on the best
      // moves. Skipped when there are too few moves for a distinct "worst".
      if (legalCount > 3) {
        engine.setOption('MultiPV', Math.min(legalCount, 80));
        const all: EngineInfo[] = [];
        await engine.go({ depth: WORST_SCAN_DEPTH }, (info) => {
          if (generation !== searchGeneration) return;
          all[info.multipv - 1] = info;
        });
        if (generation !== searchGeneration) return;
        const ranked = all.filter(Boolean);
        // seed the best list too so the UI fills instantly, then refine below
        set({ worstLines: ranked.slice(-3), lines: ranked.slice(0, 5), depth: WORST_SCAN_DEPTH });
      }

      // Phase 2 — focused, infinite, full-strength search of the best moves.
      //
      // Anti-bounce: the raw engine stream revises the ranking many times per
      // second at low depth (moves swap slots, evals flicker, board arrows
      // jump). Instead of showing every partial update, we buffer the current
      // depth's lines and only *commit* a complete, fully-ranked set when a
      // depth finishes — and no more often than once per FLUSH_MS. The result
      // updates in calm, whole steps rather than thrashing.
      const bestPv = Math.max(1, Math.min(legalCount, 5));
      engine.setOption('MultiPV', bestPv);
      engine.position(fen);

      const buf: EngineInfo[] = [];
      // Start from the depth already on screen (the shallow seed) so early,
      // shallow phase-2 updates never downgrade what the user is looking at.
      let curDepth = get().depth;
      let lastCommitAt = 0;
      // Sticky order: keep near-equal moves in their existing slots so the
      // list (and the board arrows) don't swap back and forth between two
      // moves the engine rates within a whisker of each other.
      let order: string[] = get().lines.map((l) => l.pv[0]);
      const commit = (force: boolean) => {
        if (generation !== searchGeneration) return;
        const now = Date.now();
        if (!force && now - lastCommitAt < FLUSH_MS) return;
        const snapshot = buf.filter((l) => l && l.pv[0]).slice(0, bestPv);
        if (snapshot.length === 0) return;
        const slot = (info: EngineInfo) => {
          const i = order.indexOf(info.pv[0]);
          return i < 0 ? order.length + 1 : i;
        };
        snapshot.sort((x, y) => {
          const diff = scoreToCp(y) - scoreToCp(x);
          // clear winner (>= hysteresis) reorders; otherwise hold prior order
          return Math.abs(diff) >= ORDER_HYSTERESIS ? diff : slot(x) - slot(y);
        });
        order = snapshot.map((l) => l.pv[0]);
        lastCommitAt = now;
        set({ lines: snapshot, depth: curDepth });
      };

      await engine.go({ infinite: true }, (info) => {
        if (generation !== searchGeneration) return;
        // A new depth's first line means the previous depth is fully buffered.
        if (info.multipv === 1 && info.depth > curDepth) {
          commit(false);
          curDepth = info.depth;
        }
        buf[info.multipv - 1] = info;
        resolveVerdict(fen, info);
      });
    });
  }

  /** Grade the just-played move once the after-position search is deep enough. */
  function resolveVerdict(searchFen: string, info: EngineInfo) {
    const pending = pendingVerdict;
    if (!pending || pending.forFen !== searchFen) return;
    if (info.multipv !== 1 || info.depth < 12) return;
    const current = get().verdict;
    if (current?.final) return;
    // info score is from the opponent's POV in the after-position;
    // negate to get the mover's POV.
    const evalAfterMover = -scoreToCp(info);
    const playedBest = pending.playedUci === pending.bestUci;
    const cpLoss = playedBest ? 0 : Math.max(0, pending.bestScoreCp - evalAfterMover);
    const final = info.depth >= 16;
    set({
      verdict: {
        san: pending.playedSan,
        playedUci: pending.playedUci,
        bestSan: pending.bestSan,
        bestUci: pending.bestUci,
        cpLoss,
        cls: classify(cpLoss, playedBest),
        depth: info.depth,
        final,
      },
    });
    if (final) pendingVerdict = null;
  }

  function restart() {
    set({ lines: [], worstLines: [], depth: 0 });
    void runEngine();
  }

  return {
    rootFen: START_FEN,
    variant: 'standard',
    currentNodeId: 0,
    fen: START_FEN,
    treeVersion: 0,
    engineOn: false,
    lines: [],
    worstLines: [],
    depth: 0,
    editing: false,
    loadedGameAnalysis: null,
    loadedGameId: null,
    error: null,
    verdict: null,

    setRoot: (fen, variant) => {
      tree = new MoveTree(fen);
      pendingVerdict = null;
      // The Calculator should just work: loading any real position turns the
      // engine on so best/worst moves appear immediately. The blank start
      // position stays quiet (that's the scan-a-photo landing screen).
      const engineOn = fen !== START_FEN;
      set({
        verdict: null,
        rootFen: fen,
        variant: variant ?? (fen === START_FEN ? 'standard' : 'custom'),
        currentNodeId: 0,
        fen,
        treeVersion: get().treeVersion + 1,
        loadedGameAnalysis: null,
        loadedGameId: null,
        error: null,
        engineOn,
      });
      restart();
    },

    tryMove: (from, to, promotion) => {
      const s = get();
      if (s.editing) return false;
      const g = gameAt(s.fen, s.variant);
      if (!g) return false;

      // Snapshot the engine's current best for THIS position so the played
      // move can be graded against it once the new position's search deepens.
      const bestLine = s.engineOn ? s.lines[0] : undefined;
      let snapshot: Omit<PendingVerdict, 'forFen' | 'playedUci' | 'playedSan'> | null = null;
      if (bestLine && bestLine.pv[0] && bestLine.depth >= 8) {
        const gb = gameAt(s.fen, s.variant);
        const bestRec = gb?.move(bestLine.pv[0]);
        if (bestRec) {
          snapshot = {
            bestUci: bestLine.pv[0],
            bestSan: bestRec.san,
            bestScoreCp: scoreToCp(bestLine), // mover to play in this position
          };
        }
      }

      const rec = g.move({ from, to, promotion });
      if (!rec) return false;
      pendingVerdict = snapshot
        ? { ...snapshot, forFen: rec.fenAfter, playedUci: rec.uci, playedSan: rec.san }
        : null;
      const node = tree.addMove(s.currentNodeId, rec);
      set({
        currentNodeId: node.id,
        fen: node.fen,
        treeVersion: s.treeVersion + 1,
        verdict: null,
      });
      restart();
      return true;
    },

    needsPromotion: (from, to) => {
      const s = get();
      const g = gameAt(s.fen, s.variant);
      return g ? g.needsPromotion(from, to) : false;
    },

    goto: (nodeId) => {
      try {
        const node = tree.get(nodeId);
        pendingVerdict = null;
        set({ currentNodeId: node.id, fen: node.fen, verdict: null });
        restart();
      } catch {
        /* stale id */
      }
    },

    back: () => {
      const node = tree.get(get().currentNodeId);
      if (node.parentId !== null) get().goto(node.parentId);
    },

    forward: () => {
      const node = tree.get(get().currentNodeId);
      if (node.children.length > 0) get().goto(node.children[0]);
    },

    promoteVariation: (nodeId) => {
      tree.promote(nodeId);
      set({ treeVersion: get().treeVersion + 1 });
    },

    deleteVariation: (nodeId) => {
      const s = get();
      const node = tree.get(nodeId);
      const parent = node.parentId;
      // If the current node lives in the deleted subtree, step out first.
      let cur: TreeNode | null = tree.get(s.currentNodeId);
      let inside = false;
      while (cur) {
        if (cur.id === nodeId) {
          inside = true;
          break;
        }
        cur = cur.parentId !== null ? tree.get(cur.parentId) : null;
      }
      tree.deleteSubtree(nodeId);
      if (inside && parent !== null) {
        const p = tree.get(parent);
        set({ currentNodeId: p.id, fen: p.fen, treeVersion: s.treeVersion + 1 });
        restart();
      } else {
        set({ treeVersion: s.treeVersion + 1 });
      }
    },

    toggleEngine: () => {
      const on = !get().engineOn;
      set({ engineOn: on, lines: [], worstLines: [], depth: 0, verdict: null });
      pendingVerdict = null;
      if (on) void runEngine();
      else {
        searchGeneration++;
        getAnalysisEngineRaw().stop();
      }
    },

    loadPgnText: (pgnText) => {
      try {
        const imported = importPgn(pgnText);
        tree = new MoveTree(imported.startFen);
        pendingVerdict = null;
        let nodeId = 0;
        for (const m of imported.moves) {
          nodeId = tree.addMove(nodeId, m).id;
        }
        const lastNode = tree.get(nodeId);
        set({
          rootFen: imported.startFen,
          variant: imported.variant,
          currentNodeId: lastNode.id,
          fen: lastNode.fen,
          treeVersion: get().treeVersion + 1,
          loadedGameAnalysis: null,
          loadedGameId: null,
          error: null,
          editing: false,
          verdict: null,
          engineOn: true,
        });
        restart();
        return true;
      } catch (e) {
        set({ error: e instanceof Error ? e.message : 'could not parse PGN' });
        return false;
      }
    },

    exportPgnText: () => {
      const s = get();
      const path = tree.mainline();
      return exportPgn({
        startFen: s.rootFen,
        variant: s.variant,
        moves: path.filter((n) => n.move).map((n) => n.move!),
        headers: { event: 'Analysis' },
      });
    },

    loadSavedGame: async (gameId) => {
      const saved = await (await db()).get('games', gameId);
      if (!saved || saved.game !== 'chess') return false;
      try {
        const variant = saved.variant as ChessVariant;
        const startFen = saved.startFen;
        const g =
          variant === 'chess960'
            ? new VariantGame({ variant: 'chess960', fen: startFen })
            : new VariantGame({
                variant: variant === 'standard' ? 'standard' : 'custom',
                fen: startFen,
              });
        tree = new MoveTree(startFen);
        pendingVerdict = null;
        let nodeId = 0;
        for (const uci of saved.moves) {
          const rec = g.move(uci);
          if (!rec) break;
          nodeId = tree.addMove(nodeId, rec).id;
        }
        set({
          rootFen: startFen,
          variant,
          currentNodeId: 0,
          fen: startFen,
          treeVersion: get().treeVersion + 1,
          loadedGameAnalysis: saved.analysis ?? null,
          loadedGameId: gameId,
          error: null,
          editing: false,
          verdict: null,
        });
        restart();
        return true;
      } catch {
        return false;
      }
    },

    setEditing: (on) => {
      if (on) {
        searchGeneration++;
        pendingVerdict = null;
        getAnalysisEngineRaw().stop();
        set({ editing: true, engineOn: false, lines: [], worstLines: [], depth: 0, verdict: null });
      } else {
        set({ editing: false });
      }
    },

    legalTargets: (from) => {
      const s = get();
      const g = gameAt(s.fen, s.variant);
      return g ? g.moves({ square: from }) : [];
    },

    stopEngine: () => {
      searchGeneration++;
      getAnalysisEngineRaw().stop();
      set({ engineOn: false });
    },
  };
});
