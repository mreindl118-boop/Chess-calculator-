import { Chess } from 'chess.js';
import type { EngineInfo } from './uci';
import type { PieceSymbol } from '../chess/types';

const PIECE_NAMES: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export interface ExplainedLine {
  /** SAN of the suggested move */
  san: string;
  /** white-POV centipawns (mate mapped onto ±10000 scale) */
  evalWhiteCp: number;
  /** mate distance from the mover's perspective, if forced */
  mateIn?: number;
  /** short, human explanation of what the move does and why */
  text: string;
  /** SAN preview of the continuation */
  continuation: string;
}

/**
 * Turn an engine line into a human explanation: what the move does
 * (capture/check/castle/promotion), the idea behind it (the follow-up in the
 * PV), and what the eval means for the side to move.
 */
export function explainLine(fen: string, line: EngineInfo, maxPv = 6): ExplainedLine | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const mover = chess.turn();
  const uci = line.pv[0];
  if (!uci || uci.length < 4) return null;

  let move;
  try {
    move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] as PieceSymbol | undefined,
    });
  } catch {
    return null;
  }
  if (!move) return null;

  const clauses: string[] = [];

  if (move.isKingsideCastle() || move.isQueensideCastle()) {
    clauses.push('castles, tucking the king away');
  }
  if (move.captured) {
    const attackerV = PIECE_VALUES[move.piece];
    const victimV = PIECE_VALUES[move.captured];
    if (victimV > attackerV) clauses.push(`wins the ${PIECE_NAMES[move.captured]}`);
    else if (victimV === attackerV) clauses.push(`trades off the ${PIECE_NAMES[move.captured]}`);
    else clauses.push(`captures the ${PIECE_NAMES[move.captured]}`);
  }
  if (move.promotion) clauses.push(`promotes to a ${PIECE_NAMES[move.promotion]}`);
  if (chess.isCheckmate()) clauses.length = 0; // "mate" says it all
  else if (chess.isCheck()) clauses.push('gives check');

  // The idea: does our follow-up in the PV win material or mate?
  const continuationSans: string[] = [move.san];
  let idea: string | null = null;
  for (let i = 1; i < Math.min(line.pv.length, maxPv); i++) {
    const u = line.pv[i];
    let m;
    try {
      m = chess.move({
        from: u.slice(0, 2),
        to: u.slice(2, 4),
        promotion: u[4] as PieceSymbol | undefined,
      });
    } catch {
      break;
    }
    if (!m) break;
    continuationSans.push(m.san);
    if (!idea && m.color === mover && i <= 4) {
      if (chess.isCheckmate()) idea = `mates with ${m.san}`;
      else if (m.captured && PIECE_VALUES[m.captured] >= 3) {
        idea = `then wins the ${PIECE_NAMES[m.captured]} with ${m.san}`;
      }
    }
  }
  if (idea) clauses.push(idea);

  // Eval clause, from the mover's perspective.
  const stmCp = line.scoreMate !== undefined
    ? (line.scoreMate > 0 ? 10000 - line.scoreMate : -10000 - line.scoreMate)
    : (line.scoreCp ?? 0);
  const evalWhiteCp = mover === 'w' ? stmCp : -stmCp;

  let verdict: string;
  const mate = line.scoreMate;
  if (mate !== undefined && mate > 0) {
    verdict = mate === 1 ? 'checkmate' : `forces mate in ${mate}`;
  } else if (mate !== undefined && mate < 0) {
    verdict = `delays mate (opponent mates in ${-mate})`;
  } else if (stmCp >= 500) verdict = 'completely winning';
  else if (stmCp >= 200) verdict = 'a winning advantage';
  else if (stmCp >= 80) verdict = 'clearly better';
  else if (stmCp >= 30) verdict = 'slightly better';
  else if (stmCp > -30) verdict = 'a balanced game';
  else if (stmCp > -200) verdict = 'the best defence, though still worse';
  else verdict = 'the most resilient defence in a lost position';

  let text: string;
  if (chess.isCheckmate() && continuationSans.length === 1) {
    text = 'Checkmate.';
  } else if (clauses.length > 0) {
    text = capitalize(joinClauses(clauses)) + ` — ${verdict}.`;
  } else {
    text = capitalize(verdict) + (quietHint(move) ? ` — ${quietHint(move)}` : '') + '.';
  }

  return {
    san: move.san,
    evalWhiteCp,
    mateIn: mate !== undefined && mate > 0 ? mate : undefined,
    text,
    continuation: continuationSans.join(' '),
  };
}

/** A flavour hint for quiet moves. */
function quietHint(move: {
  piece: string;
  from: string;
  to: string;
  san: string;
}): string | null {
  const toRank = move.to[1];
  const fromRank = move.from[1];
  if (move.piece === 'p' && (toRank === '4' || toRank === '5') && (fromRank === '2' || fromRank === '7')) {
    return 'grabs space in the centre';
  }
  if ((move.piece === 'n' || move.piece === 'b') && (fromRank === '1' || fromRank === '8')) {
    return 'develops a piece';
  }
  if (move.piece === 'r' && 'de'.includes(move.to[0])) {
    return 'centralizes the rook';
  }
  if (move.piece === 'k') return 'improves king safety';
  return null;
}

function joinClauses(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
