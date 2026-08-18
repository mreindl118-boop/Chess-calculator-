import { Chess, type Square as CjsSquare } from 'chess.js';
import {
  type ChessVariant,
  type Color,
  type GameOverState,
  type PieceSymbol,
  type RecordedMove,
  type Square,
  type UiMove,
  START_FEN,
  FILES,
  fileOf,
  rankOf,
  repetitionKey,
  squareOf,
} from './types';
import { chess960Fen, randomChess960Position, rookFilesOf } from './chess960';
import { reallyBadChessFen, type RbcOptions } from './reallyBadChess';

interface SideRights {
  /** rook starting file for kingside castling, or null if right lost */
  k: number | null;
  /** rook starting file for queenside castling, or null if right lost */
  q: number | null;
  kingFile: number;
}
interface Rights {
  w: SideRights;
  b: SideRights;
}

export interface VariantGameOptions {
  variant: ChessVariant;
  /** starting FEN for 'custom'; ignored for generated variants */
  fen?: string;
  /** Chess960: fixed position number 0-959. Omit for random. */
  position960?: number;
  seed?: number;
  rbc?: Omit<RbcOptions, 'seed'>;
}

/**
 * Rules facade for all chess variants.
 *
 * Standard + custom-FEN games delegate entirely to chess.js. Chess960 also
 * delegates for ordinary moves, but castling (generation, legality and
 * execution) is implemented here, with castling rights tracked per rook file —
 * chess.js itself has no 960 support, so the FEN handed to it always carries
 * castling '-' in that variant.
 *
 * Repetition counting is done here for every variant so that undo, manual
 * castling and custom starts all count correctly.
 */
export class VariantGame {
  readonly variant: ChessVariant;
  readonly startFen: string;
  /** Chess960 position number, when applicable. */
  readonly position960?: number;
  /** RBC generation seed, when applicable. */
  readonly seed?: number;

  private chess: Chess;
  private rights: Rights | null = null;
  private repCounts = new Map<string, number>();
  private hist: Array<RecordedMove & { rightsBefore: Rights | null }> = [];

  constructor(opts: VariantGameOptions) {
    this.variant = opts.variant;
    switch (opts.variant) {
      case 'standard':
        this.startFen = opts.fen ?? START_FEN;
        break;
      case 'custom':
        if (!opts.fen) throw new Error('custom variant requires a FEN');
        this.startFen = opts.fen;
        break;
      case 'chess960': {
        if (opts.fen) {
          // Resuming/importing a 960 game from an arbitrary FEN. The castling
          // field may be KQkq, Shredder-style (A-H/a-h), or '-'; chess.js gets
          // a '-' either way since we manage 960 castling ourselves.
          this.startFen = normalize960Fen(opts.fen);
          this.rights = rightsFromFen(opts.fen);
        } else if (opts.position960 !== undefined) {
          this.position960 = opts.position960;
          this.startFen = chess960Fen(opts.position960);
        } else {
          const p = randomChess960Position(opts.seed);
          this.position960 = p.n;
          this.startFen = p.fen;
        }
        break;
      }
      case 'rbc-chaos':
      case 'rbc-handicap': {
        const mode = opts.variant === 'rbc-chaos' ? 'chaos' : 'handicap';
        const r = reallyBadChessFen({ mode, seed: opts.seed, ...(opts.rbc ?? {}) });
        this.startFen = r.fen;
        this.seed = r.seed;
        break;
      }
    }
    this.chess = new Chess(this.startFen);
    if (opts.variant === 'chess960' && !this.rights) {
      const backRank = this.startFen.split('/')[7].split(' ')[0].toLowerCase();
      const { kingFile, aRook, hRook } = rookFilesOf(backRank);
      this.rights = {
        w: { k: hRook, q: aRook, kingFile },
        b: { k: hRook, q: aRook, kingFile },
      };
    }
    this.bumpRepetition(this.chess.fen());
  }

  // ---------------------------------------------------------------- accessors

  fen(): string {
    return this.chess.fen();
  }
  turn(): Color {
    return this.chess.turn();
  }
  board() {
    return this.chess.board();
  }
  get(square: Square) {
    return this.chess.get(square as CjsSquare) ?? undefined;
  }
  history(): RecordedMove[] {
    return this.hist;
  }
  lastMove(): RecordedMove | undefined {
    return this.hist[this.hist.length - 1];
  }
  isCheck(): boolean {
    return this.chess.isCheck();
  }
  /** Square of the king that is currently in check, if any. */
  checkedKingSquare(): Square | undefined {
    if (!this.chess.isCheck()) return undefined;
    return this.kingSquare(this.turn());
  }
  kingSquare(color: Color): Square | undefined {
    const b = this.chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = b[r][f];
        if (p && p.type === 'k' && p.color === color) return squareOf(f, 7 - r);
      }
    }
    return undefined;
  }
  halfmoveClock(): number {
    return parseInt(this.chess.fen().split(' ')[4], 10);
  }

  isCheckmate(): boolean {
    return this.chess.isCheckmate();
  }
  isStalemate(): boolean {
    if (this.chess.isCheckmate()) return false;
    return this.moves().length === 0;
  }
  isInsufficientMaterial(): boolean {
    return this.chess.isInsufficientMaterial();
  }
  isFiftyMoves(): boolean {
    return this.halfmoveClock() >= 100;
  }
  isThreefoldRepetition(): boolean {
    return (this.repCounts.get(repetitionKey(this.chess.fen())) ?? 0) >= 3;
  }

  gameOver(): GameOverState {
    if (this.isCheckmate()) {
      const winner = this.turn() === 'w' ? 'b' : 'w';
      return {
        over: true,
        result: winner === 'w' ? '1-0' : '0-1',
        reason: 'checkmate',
        winner,
      };
    }
    if (this.isStalemate()) return { over: true, result: '1/2-1/2', reason: 'stalemate' };
    if (this.isInsufficientMaterial())
      return { over: true, result: '1/2-1/2', reason: 'insufficient' };
    if (this.isThreefoldRepetition()) return { over: true, result: '1/2-1/2', reason: 'threefold' };
    if (this.isFiftyMoves()) return { over: true, result: '1/2-1/2', reason: 'fifty-move' };
    return { over: false };
  }

  // ------------------------------------------------------------------- moves

  /** All legal moves, optionally restricted to a source square. */
  moves(opts?: { square?: Square }): UiMove[] {
    const raw = this.chess.moves({
      verbose: true,
      ...(opts?.square ? { square: opts.square as CjsSquare } : {}),
    });
    const list: UiMove[] = raw.map((m) => ({
      from: m.from,
      to: m.to,
      promotion: m.promotion as PieceSymbol | undefined,
      castle: m.isKingsideCastle() ? 'k' : m.isQueensideCastle() ? 'q' : undefined,
    }));
    if (this.variant === 'chess960' && this.rights) {
      const color = this.turn();
      const kingSq = this.kingSquare(color);
      if (kingSq && (!opts?.square || opts.square === kingSq)) {
        for (const side of ['k', 'q'] as const) {
          const c = this.castle960Squares(color, side);
          if (c && this.can960Castle(color, side)) {
            list.push({ from: c.kingFrom, to: c.rookFrom, castle: side });
          }
        }
      }
    }
    return list;
  }

  /**
   * Play a move. Accepts a UiMove or a UCI string (960 castling encoded as
   * king-to-rook-square, matching UCI_Chess960). Returns the recorded move or
   * null if illegal.
   */
  move(input: UiMove | string): RecordedMove | null {
    const m = typeof input === 'string' ? this.parseUci(input) : input;
    if (!m) return null;

    if (this.variant === 'chess960') {
      const castle = this.matchCastle960(m);
      if (castle) return this.do960Castle(castle.color, castle.side);
      // A king "capturing" its own rook can only be a castle attempt.
      const target = this.get(m.to);
      const piece = this.get(m.from);
      if (piece?.type === 'k' && target && target.color === piece.color) return null;
    }

    const fenBefore = this.chess.fen();
    const rightsBefore = this.snapshotRights();
    let mv;
    try {
      mv = this.chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch {
      return null;
    }
    if (!mv) return null;

    if (this.variant === 'chess960') this.update960Rights(mv.color, mv.piece, mv.from, mv.to);

    const rec: RecordedMove & { rightsBefore: Rights | null } = {
      san: mv.san,
      uci: mv.from + mv.to + (mv.promotion ?? ''),
      from: mv.from,
      to: mv.to,
      color: mv.color,
      piece: mv.piece,
      promotion: mv.promotion as PieceSymbol | undefined,
      captured: mv.captured as PieceSymbol | undefined,
      castle: mv.isKingsideCastle() ? 'k' : mv.isQueensideCastle() ? 'q' : undefined,
      isEnPassant: mv.isEnPassant(),
      check: this.chess.isCheck(),
      mate: this.chess.isCheckmate(),
      fenBefore,
      fenAfter: this.chess.fen(),
      rightsBefore,
    };
    this.hist.push(rec);
    this.bumpRepetition(rec.fenAfter);
    return rec;
  }

  undo(): RecordedMove | null {
    const last = this.hist.pop();
    if (!last) return null;
    this.dropRepetition(this.chess.fen());
    this.chess.load(last.fenBefore);
    this.rights = last.rightsBefore;
    return last;
  }

  // -------------------------------------------------------------- 960 castling

  private snapshotRights(): Rights | null {
    if (!this.rights) return null;
    return JSON.parse(JSON.stringify(this.rights));
  }

  private update960Rights(color: Color, piece: PieceSymbol, from: Square, to: Square) {
    if (!this.rights) return;
    const side = this.rights[color];
    const backRank = color === 'w' ? 0 : 7;
    if (piece === 'k') {
      side.k = null;
      side.q = null;
    } else if (piece === 'r' && rankOf(from) === backRank) {
      if (side.k !== null && fileOf(from) === side.k) side.k = null;
      if (side.q !== null && fileOf(from) === side.q) side.q = null;
    }
    // Capture landing on an opponent rook's start square kills that right.
    const opp: Color = color === 'w' ? 'b' : 'w';
    const oppSide = this.rights[opp];
    const oppBack = opp === 'w' ? 0 : 7;
    if (rankOf(to) === oppBack) {
      if (oppSide.k !== null && fileOf(to) === oppSide.k) oppSide.k = null;
      if (oppSide.q !== null && fileOf(to) === oppSide.q) oppSide.q = null;
    }
  }

  private castle960Squares(color: Color, side: 'k' | 'q') {
    if (!this.rights) return null;
    const r = this.rights[color];
    const rookFile = side === 'k' ? r.k : r.q;
    if (rookFile === null) return null;
    const rank = color === 'w' ? 0 : 7;
    const kingSq = this.kingSquare(color);
    if (!kingSq || rankOf(kingSq) !== rank) return null;
    return {
      color,
      side,
      kingFrom: kingSq,
      rookFrom: squareOf(rookFile, rank),
      kingTo: squareOf(side === 'k' ? 6 : 2, rank),
      rookTo: squareOf(side === 'k' ? 5 : 3, rank),
    };
  }

  private can960Castle(color: Color, side: 'k' | 'q'): boolean {
    const c = this.castle960Squares(color, side);
    if (!c || this.turn() !== color) return false;
    const rookPiece = this.get(c.rookFrom);
    if (!rookPiece || rookPiece.type !== 'r' || rookPiece.color !== color) return false;

    // Every square the king or rook crosses (or lands on) must be empty,
    // apart from the king and rook themselves.
    const between = new Set<Square>();
    const addRange = (a: Square, b: Square) => {
      const rank = rankOf(a);
      const [lo, hi] = [Math.min(fileOf(a), fileOf(b)), Math.max(fileOf(a), fileOf(b))];
      for (let f = lo; f <= hi; f++) between.add(squareOf(f, rank));
    };
    addRange(c.kingFrom, c.kingTo);
    addRange(c.rookFrom, c.rookTo);
    between.delete(c.kingFrom);
    between.delete(c.rookFrom);
    for (const sq of between) {
      if (this.get(sq)) return false;
    }

    // King's path (start through destination) must not be attacked. The king
    // and castling rook are lifted off the board for the attack scan, matching
    // engine behavior for discovered-ray edge cases.
    const opp: Color = color === 'w' ? 'b' : 'w';
    const king = this.chess.remove(c.kingFrom as CjsSquare);
    const rook =
      c.rookFrom !== c.kingFrom ? this.chess.remove(c.rookFrom as CjsSquare) : undefined;
    let safe = true;
    try {
      const rank = rankOf(c.kingFrom);
      const [lo, hi] = [
        Math.min(fileOf(c.kingFrom), fileOf(c.kingTo)),
        Math.max(fileOf(c.kingFrom), fileOf(c.kingTo)),
      ];
      for (let f = lo; f <= hi; f++) {
        if (this.chess.isAttacked(squareOf(f, rank) as CjsSquare, opp)) {
          safe = false;
          break;
        }
      }
    } finally {
      if (king) this.chess.put(king, c.kingFrom as CjsSquare);
      if (rook) this.chess.put(rook, c.rookFrom as CjsSquare);
    }
    return safe;
  }

  /** Detect whether a UiMove is a 960 castle attempt (king onto own rook, or king two files). */
  private matchCastle960(m: UiMove): { color: Color; side: 'k' | 'q' } | null {
    if (this.variant !== 'chess960' || !this.rights) return null;
    const piece = this.get(m.from);
    if (!piece || piece.type !== 'k' || piece.color !== this.turn()) return null;
    const color = piece.color;
    for (const side of ['k', 'q'] as const) {
      const c = this.castle960Squares(color, side);
      if (!c || c.kingFrom !== m.from) continue;
      const explicit = m.castle === side || m.to === c.rookFrom;
      // Also accept king->g/c file when that is not an ordinary legal king move.
      const kingDest =
        m.to === c.kingTo &&
        !this.chess
          .moves({ verbose: true, square: m.from as CjsSquare })
          .some((x) => x.to === c.kingTo);
      if ((explicit || kingDest) && this.can960Castle(color, side)) return { color, side };
    }
    return null;
  }

  private do960Castle(color: Color, side: 'k' | 'q'): RecordedMove | null {
    const c = this.castle960Squares(color, side);
    if (!c || !this.can960Castle(color, side)) return null;
    const fenBefore = this.chess.fen();
    const rightsBefore = this.snapshotRights();

    const king = this.chess.remove(c.kingFrom as CjsSquare)!;
    const rook = this.chess.remove(c.rookFrom as CjsSquare)!;
    this.chess.put(king, c.kingTo as CjsSquare);
    this.chess.put(rook, c.rookTo as CjsSquare);

    // Patch the non-placement FEN fields: side to move, ep, clocks.
    const parts = this.chess.fen().split(' ');
    const fullmove = parseInt(parts[5], 10);
    parts[1] = color === 'w' ? 'b' : 'w';
    parts[2] = '-';
    parts[3] = '-';
    parts[4] = String(parseInt(fenBefore.split(' ')[4], 10) + 1);
    parts[5] = String(color === 'b' ? parseInt(fenBefore.split(' ')[5], 10) + 1 : fullmove);
    this.chess.load(parts.join(' '));

    const r = this.rights![color];
    r.k = null;
    r.q = null;

    const check = this.chess.isCheck();
    const mate = this.chess.isCheckmate();
    const rec: RecordedMove & { rightsBefore: Rights | null } = {
      san: (side === 'k' ? 'O-O' : 'O-O-O') + (mate ? '#' : check ? '+' : ''),
      uci: c.kingFrom + c.rookFrom, // UCI_Chess960 king-takes-rook encoding
      from: c.kingFrom,
      to: c.rookFrom,
      color,
      piece: 'k',
      castle: side,
      check,
      mate,
      fenBefore,
      fenAfter: this.chess.fen(),
      rightsBefore,
    };
    this.hist.push(rec);
    this.bumpRepetition(rec.fenAfter);
    return rec;
  }

  // ------------------------------------------------------------------ helpers

  private parseUci(uci: string): UiMove | null {
    if (!/^[a-h][1-8][a-h][1-8][nbrq]?$/.test(uci)) return null;
    return {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: (uci[4] as PieceSymbol | undefined) ?? undefined,
    };
  }

  private bumpRepetition(fen: string) {
    const key = repetitionKey(fen);
    this.repCounts.set(key, (this.repCounts.get(key) ?? 0) + 1);
  }
  private dropRepetition(fen: string) {
    const key = repetitionKey(fen);
    const n = (this.repCounts.get(key) ?? 1) - 1;
    if (n <= 0) this.repCounts.delete(key);
    else this.repCounts.set(key, n);
  }

  /** UCI move list from the start position (for `position fen ... moves ...`). */
  uciMoves(): string[] {
    return this.hist.map((m) => m.uci);
  }

  /** Does the side to move have a pawn move from->to that requires promotion? */
  needsPromotion(from: Square, to: Square): boolean {
    return this.moves({ square: from }).some((m) => m.to === to && m.promotion);
  }

  /** File names for coordinates, exported for UI convenience. */
  static readonly files = FILES;
}

/** Replace the castling field with '-' (VariantGame owns 960 castling). */
function normalize960Fen(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  parts[2] = '-';
  return parts.join(' ');
}

/**
 * Derive 960 castling rights from a FEN. Supports standard KQkq letters and
 * Shredder-style file letters (A-H / a-h). Rights are only granted when a
 * king and a rook actually stand on the implied squares.
 */
function rightsFromFen(fen: string): Rights {
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split('/');
  const castling = parts[2] ?? '-';

  const expand = (row: string): string[] => {
    const out: string[] = [];
    for (const ch of row) {
      if (/\d/.test(ch)) out.push(...Array(parseInt(ch, 10)).fill(''));
      else out.push(ch);
    }
    return out;
  };
  const rank1 = expand(rows[7]); // white back rank
  const rank8 = expand(rows[0]); // black back rank

  const sideFor = (rank: string[], king: string, rook: string, tokens: string): SideRights => {
    const kingFile = rank.indexOf(king);
    const side: SideRights = { k: null, q: null, kingFile };
    if (kingFile < 0) return side;
    const rookFiles: number[] = [];
    rank.forEach((p, f) => {
      if (p === rook) rookFiles.push(f);
    });
    const isWhite = king === 'K';
    for (const t of tokens) {
      if (isWhite ? t !== t.toUpperCase() : t !== t.toLowerCase()) continue;
      const u = t.toUpperCase();
      if (u === 'K') {
        const rf = rookFiles.filter((f) => f > kingFile).pop();
        if (rf !== undefined) side.k = rf;
      } else if (u === 'Q') {
        const rf = rookFiles.find((f) => f < kingFile);
        if (rf !== undefined) side.q = rf;
      } else if (u >= 'A' && u <= 'H') {
        const f = u.charCodeAt(0) - 65;
        if (rookFiles.includes(f)) {
          if (f > kingFile) side.k = f;
          else if (f < kingFile) side.q = f;
        }
      }
    }
    return side;
  };

  return {
    w: sideFor(rank1, 'K', 'R', castling === '-' ? '' : castling),
    b: sideFor(rank8, 'k', 'r', castling === '-' ? '' : castling),
  };
}
