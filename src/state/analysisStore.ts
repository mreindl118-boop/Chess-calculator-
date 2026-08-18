import { create } from 'zustand';
import { MoveTree, type TreeNode } from '../lib/chess/moveTree';
import { VariantGame } from '../lib/chess/variantGame';
import { START_FEN, type ChessVariant, type PieceSymbol, type Square } from '../lib/chess/types';
import { getAnalysisEngineRaw, withAnalysisEngine } from './engineHub';
import type { EngineInfo } from '../lib/engine/uci';
import { exportPgn, importPgn } from '../lib/chess/pgn';
import { db } from '../lib/db/schema';
import type { GameAnalysis } from '../lib/engine/analysis';

export interface AnalysisState {
  rootFen: string;
  variant: ChessVariant;
  currentNodeId: number;
  fen: string;
  /** bumped whenever the tree structure changes, to re-render the tree view */
  treeVersion: number;
  engineOn: boolean;
  lines: EngineInfo[];
  depth: number;
  editing: boolean;
  loadedGameAnalysis: GameAnalysis | null;
  loadedGameId: string | null;
  error: string | null;

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
    await withAnalysisEngine(async (engine) => {
      if (generation !== searchGeneration) return;
      engine.setOption('MultiPV', 3);
      engine.setOption('UCI_LimitStrength', false);
      engine.setOption('Skill Level', 20);
      engine.setOption('UCI_Chess960', variant === 'chess960');
      engine.position(fen);
      await engine.go({ infinite: true }, (info) => {
        if (generation !== searchGeneration) return;
        set((s) => {
          const lines = [...s.lines];
          lines[info.multipv - 1] = info;
          return { lines, depth: info.multipv === 1 ? info.depth : s.depth };
        });
      });
    });
  }

  function restart() {
    set({ lines: [], depth: 0 });
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
    depth: 0,
    editing: false,
    loadedGameAnalysis: null,
    loadedGameId: null,
    error: null,

    setRoot: (fen, variant) => {
      tree = new MoveTree(fen);
      set({
        rootFen: fen,
        variant: variant ?? (fen === START_FEN ? 'standard' : 'custom'),
        currentNodeId: 0,
        fen,
        treeVersion: get().treeVersion + 1,
        loadedGameAnalysis: null,
        loadedGameId: null,
        error: null,
      });
      restart();
    },

    tryMove: (from, to, promotion) => {
      const s = get();
      if (s.editing) return false;
      const g = gameAt(s.fen, s.variant);
      if (!g) return false;
      const rec = g.move({ from, to, promotion });
      if (!rec) return false;
      const node = tree.addMove(s.currentNodeId, rec);
      set({ currentNodeId: node.id, fen: node.fen, treeVersion: s.treeVersion + 1 });
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
        set({ currentNodeId: node.id, fen: node.fen });
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
      set({ engineOn: on, lines: [], depth: 0 });
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
        getAnalysisEngineRaw().stop();
        set({ editing: true, engineOn: false, lines: [], depth: 0 });
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
