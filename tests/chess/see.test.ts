import { describe, expect, it } from 'vitest';
import {
  findSacrifices,
  pvMateForMover,
  pvToSanLine,
  tierFor,
} from '../../src/lib/chess/see';

const has = (fen: string, uci: string) => findSacrifices(fen).find((c) => c.uci === uci);

describe('tierFor', () => {
  it('maps invested pawns to magnitude rungs', () => {
    expect(tierFor(3)).toBe('spicy');
    expect(tierFor(4)).toBe('spicy');
    expect(tierFor(5)).toBe('unhinged');
    expect(tierFor(8)).toBe('unhinged');
    expect(tierFor(9)).toBe('psychotic');
    expect(tierFor(12)).toBe('psychotic');
  });
});

describe('findSacrifices (SEE-based detector)', () => {
  it('flags a non-capture that leaves a piece en prise (queen into a pawn attack)', () => {
    // White Qd1-d5: d5 is attacked only by the e6 pawn and undefended → invests the queen.
    const fen = '4k3/8/4p3/8/8/8/8/3QK3 w - - 0 1';
    const c = has(fen, 'd1d5');
    expect(c).toBeTruthy();
    expect(c!.invested).toBe(9);
    expect(c!.tier).toBe('psychotic');
    expect(c!.movedType).toBe('q');
    // A safe queen move is not a sacrifice.
    expect(has(fen, 'd1d2')).toBeUndefined();
  });

  it('flags a losing capture (rook takes a pawn defended by a pawn = the exchange)', () => {
    const fen = '4k3/8/4p3/3p4/8/8/8/3RK3 w - - 0 1';
    const c = has(fen, 'd1d5');
    expect(c).toBeTruthy();
    expect(c!.invested).toBe(4); // won a pawn (1), lost the rook (5)
    expect(c!.tier).toBe('spicy');
  });

  it('excludes a winning capture (rook takes an undefended pawn)', () => {
    const fen = '4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1';
    expect(has(fen, 'd1d5')).toBeUndefined();
  });

  it('excludes a SEE-neutral equal trade (queen takes a defended queen)', () => {
    const fen = '4k3/8/4p3/3q4/8/8/8/3QK3 w - - 0 1';
    expect(has(fen, 'd1d5')).toBeUndefined();
  });

  it('flags abandonment: advancing the pawn that defends a knight leaves the knight winnable', () => {
    // c3 pawn defends Nd4 (attacked by Bg7). c3-c4 abandons the defence.
    const fen = '4k3/6b1/8/8/3N4/2P5/8/4K3 w - - 0 1';
    const c = has(fen, 'c3c4');
    expect(c).toBeTruthy();
    expect(c!.invested).toBe(3); // the knight becomes winnable
    expect(c!.tier).toBe('spicy');
  });

  it('returns [] for an unparseable FEN instead of throwing', () => {
    expect(findSacrifices('not a fen')).toEqual([]);
  });
});

describe('pvMateForMover (chess.js checkmate cross-check)', () => {
  it('accepts a real forced mate delivered by the mover', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1';
    expect(pvMateForMover(fen, ['a1a8'])).toBe(1); // Ra8#
  });

  it('rejects a line that does not end in checkmate', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1';
    expect(pvMateForMover(fen, ['a1a4'])).toBeNull();
  });

  it('rejects an even-length line (mate would be delivered by the opponent)', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1';
    expect(pvMateForMover(fen, ['a1a8', 'g8h8x'])).toBeNull();
  });

  it('pvToSanLine converts a UCI line to SAN', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1';
    expect(pvToSanLine(fen, ['a1a8'])).toEqual(['Ra8#']);
  });
});
