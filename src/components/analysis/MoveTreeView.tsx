import { Fragment, type ReactNode } from 'react';
import type { MoveTree, TreeNode } from '../../lib/chess/moveTree';

/**
 * Renders the analysis tree lichess-study style: main line inline, variations
 * in parentheses, recursively.
 */
export function MoveTreeView({
  tree,
  currentNodeId,
  onSelect,
  onPromote,
  onDelete,
}: {
  tree: MoveTree;
  currentNodeId: number;
  onSelect: (id: number) => void;
  onPromote: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  function moveLabel(node: TreeNode): string {
    const move = node.move!;
    const parts = move.fenBefore.split(' ');
    const num = parts[5];
    if (move.color === 'w') return `${num}. ${move.san}`;
    return move.san;
  }

  function blackIntro(node: TreeNode): string {
    const move = node.move!;
    const num = move.fenBefore.split(' ')[5];
    return `${num}… ${move.san}`;
  }

  function renderLine(startId: number, introBlack: boolean): ReactNode[] {
    const out: ReactNode[] = [];
    let id: number | null = startId;
    let first = true;
    while (id !== null) {
      const node: TreeNode = tree.get(id);
      if (!node.move) break;
      const label = first && introBlack && node.move.color === 'b' ? blackIntro(node) : moveLabel(node);
      const isCurrent = node.id === currentNodeId;
      out.push(
        <span key={node.id} className="tree-move-wrap">
          <button
            className={`tree-move ${isCurrent ? 'active' : ''}`}
            onClick={() => onSelect(node.id)}
          >
            {label}
          </button>
          {isCurrent && node.parentId !== null && (
            <span className="tree-ops">
              <button className="tree-op" title="Promote variation" onClick={() => onPromote(node.id)}>
                ↑
              </button>
              <button className="tree-op" title="Delete from here" onClick={() => onDelete(node.id)}>
                ✕
              </button>
            </span>
          )}
        </span>,
      );
      // PGN order: alternatives to THIS move follow it in parentheses. Only
      // the primary child renders its siblings (variation lines don't recurse
      // back into their own fork).
      if (node.parentId !== null) {
        const parent = tree.get(node.parentId);
        if (parent.children[0] === node.id && parent.children.length > 1) {
          out.push(
            <Fragment key={`var-${node.id}`}>
              {parent.children.slice(1).map((vid) => (
                <span key={vid} className="tree-variation">
                  ({renderLine(vid, true)})
                </span>
              ))}
            </Fragment>,
          );
        }
      }
      id = node.children.length > 0 ? node.children[0] : null;
      first = false;
    }
    return out;
  }

  const root = tree.root();
  return (
    <div className="move-tree">
      {root.children.length === 0 ? (
        <span className="tree-empty">Play moves on the board to build a tree.</span>
      ) : (
        renderLine(root.children[0], false)
      )}
    </div>
  );
}
