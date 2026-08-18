export type ChessVariant = 'standard' | 'chess960' | 'rbc-chaos' | 'rbc-handicap' | 'custom';
export type Color = 'w' | 'b';
export type PieceSymbol = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Square = string; // 'a1'..'h8'

export interface Piece {
  color: Color;
  type: PieceSymbol;
}

/** A move as offered to the UI / accepted from the UI. */
export interface UiMove {
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
  /** 'k' kingside castle, 'q' queenside castle (Chess960 castles are synthesized) */
  castle?: 'k' | 'q';
}

/** A move that has been played, with everything needed for lists/undo/PGN/engine. */
export interface RecordedMove {
  san: string;
  /** canonical UCI: e2e4, e7e8q; 960 castling is king->rook-square */
  uci: string;
  from: Square;
  to: Square;
  color: Color;
  piece: PieceSymbol;
  promotion?: PieceSymbol;
  captured?: PieceSymbol;
  castle?: 'k' | 'q';
  isEnPassant?: boolean;
  check: boolean;
  mate: boolean;
  fenBefore: string;
  fenAfter: string;
}

export type GameResult = '1-0' | '0-1' | '1/2-1/2';

export type GameEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'fifty-move'
  | 'insufficient'
  | 'resign'
  | 'timeout'
  | 'timeout-insufficient'
  | 'agreement'
  | 'abort';

export interface GameOverState {
  over: boolean;
  result?: GameResult;
  reason?: GameEndReason;
  winner?: Color;
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

export function squareOf(file: number, rank: number): Square {
  return FILES[file] + RANKS[rank];
}
export function fileOf(sq: Square): number {
  return sq.charCodeAt(0) - 97;
}
export function rankOf(sq: Square): number {
  return sq.charCodeAt(1) - 49;
}
export function opposite(c: Color): Color {
  return c === 'w' ? 'b' : 'w';
}

/** First 4 FEN fields — the identity of a position for repetition purposes. */
export function repetitionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}
