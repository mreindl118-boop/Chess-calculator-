import type { RecordedMove } from './types';

export interface TreeNode {
  id: number;
  parentId: number | null;
  move: RecordedMove | null; // null only at the root
  fen: string;
  children: number[]; // child ids; children[0] is the main continuation
  comment?: string;
  /** engine eval in centipawns from white's POV, if analyzed */
  evalCp?: number;
  evalMate?: number;
}

/**
 * A tree of positions for the Analysis Lab: a root FEN plus arbitrarily nested
 * variations. Stored flat (id -> node) so it serializes straight to JSON.
 */
export class MoveTree {
  nodes = new Map<number, TreeNode>();
  rootId = 0;
  private nextId = 1;

  constructor(rootFen: string) {
    this.nodes.set(0, { id: 0, parentId: null, move: null, fen: rootFen, children: [] });
  }

  get(id: number): TreeNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`no tree node ${id}`);
    return n;
  }

  root(): TreeNode {
    return this.get(this.rootId);
  }

  /**
   * Add a move played from `parentId`. If the same move already exists as a
   * child, that child is returned instead of duplicating the branch.
   */
  addMove(parentId: number, move: RecordedMove): TreeNode {
    const parent = this.get(parentId);
    for (const cid of parent.children) {
      const child = this.get(cid);
      if (child.move && child.move.uci === move.uci) return child;
    }
    const node: TreeNode = {
      id: this.nextId++,
      parentId,
      move,
      fen: move.fenAfter,
      children: [],
    };
    this.nodes.set(node.id, node);
    parent.children.push(node.id);
    return node;
  }

  /** Path of nodes from root (exclusive) to `id` (inclusive). */
  pathTo(id: number): TreeNode[] {
    const path: TreeNode[] = [];
    let cur: TreeNode | null = this.get(id);
    while (cur && cur.parentId !== null) {
      path.push(cur);
      cur = this.nodes.get(cur.parentId) ?? null;
    }
    return path.reverse();
  }

  /** Main line from root. */
  mainline(): TreeNode[] {
    const out: TreeNode[] = [];
    let cur = this.root();
    while (cur.children.length > 0) {
      cur = this.get(cur.children[0]);
      out.push(cur);
    }
    return out;
  }

  /** Make the branch containing `id` the first (main) child at its fork. */
  promote(id: number): void {
    const node = this.get(id);
    if (node.parentId === null) return;
    const parent = this.get(node.parentId);
    const idx = parent.children.indexOf(id);
    if (idx > 0) {
      parent.children.splice(idx, 1);
      parent.children.unshift(id);
    }
  }

  /** Delete a node and its whole subtree. */
  deleteSubtree(id: number): void {
    const node = this.get(id);
    if (node.parentId === null) return; // never delete the root
    const parent = this.get(node.parentId);
    parent.children = parent.children.filter((c) => c !== id);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      const n = this.nodes.get(cur);
      if (!n) continue;
      stack.push(...n.children);
      this.nodes.delete(cur);
    }
  }

  toJSON() {
    return {
      rootId: this.rootId,
      nextId: this.nextId,
      nodes: [...this.nodes.values()],
    };
  }

  static fromJSON(data: ReturnType<MoveTree['toJSON']>): MoveTree {
    const t = new MoveTree('');
    t.nodes = new Map(data.nodes.map((n) => [n.id, n]));
    t.rootId = data.rootId;
    (t as any).nextId = data.nextId;
    return t;
  }
}
