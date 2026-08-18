import { describe, expect, it } from 'vitest';
import { reallyBadChessFen, handicapBias } from '../../src/lib/chess/reallyBadChess';
import { VariantGame } from '../../src/lib/chess/variantGame';
import { exportPgn, importPgn } from '../../src/lib/chess/pgn';

describe('Really Bad Chess generation', () => {
  it('is deterministic for a given seed and always playable', () => {
    const a = reallyBadChessFen({ mode: 'chaos', seed: 42 });
    const b = reallyBadChessFen({ mode: 'chaos', seed: 42 });
    expect(a.fen).toBe(b.fen);
    const g = new VariantGame({ variant: 'rbc-chaos', seed: 42 });
    expect(g.moves().length).toBeGreaterThan(0);
    expect(g.isCheck()).toBe(false);
  });

  it('always keeps both kings on their home squares and never pawns on back ranks', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { fen } = reallyBadChessFen({ mode: 'chaos', seed });
      const rows = fen.split(' ')[0].split('/');
      expect(rows[7][4]).toBe('K');
      expect(rows[0][4]).toBe('k');
      expect(rows[0]).not.toContain('p');
      expect(rows[7]).not.toContain('P');
      const placement = fen.split(' ')[0];
      expect(placement.match(/K/g)!.length).toBe(1);
      expect(placement.match(/k/g)!.length).toBe(1);
    }
  });

  it('handicap bias grows with the rating gap', () => {
    expect(handicapBias(100)).toBeLessThan(handicapBias(400));
    expect(handicapBias(400)).toBeLessThan(handicapBias(800));
    expect(handicapBias(1200)).toBe(handicapBias(800)); // capped
  });

  it('handicap mode gives the weaker side more material on average', () => {
    const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let whiteTotal = 0;
    let blackTotal = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { fen } = reallyBadChessFen({ mode: 'handicap', seed, ratingGap: 600 });
      const placement = fen.split(' ')[0];
      for (const ch of placement) {
        if (/[pnbrqk]/.test(ch)) blackTotal += VALUES[ch];
        else if (/[PNBRQK]/.test(ch)) whiteTotal += VALUES[ch.toLowerCase()];
      }
    }
    // positive gap = white stronger player, so black gets the better army
    expect(blackTotal).toBeGreaterThan(whiteTotal * 1.15);
  });
});

describe('PGN export/import', () => {
  it('round-trips a standard game', () => {
    const g = new VariantGame({ variant: 'standard' });
    for (const m of ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6']) g.move(m);
    const pgn = exportPgn({
      startFen: g.startFen,
      variant: 'standard',
      moves: g.history(),
      headers: { white: 'Alice', black: 'Bob' },
      result: '*',
    });
    expect(pgn).toContain('[White "Alice"]');
    expect(pgn).toContain('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6');
    const imported = importPgn(pgn);
    expect(imported.moves.map((m) => m.san)).toEqual(g.history().map((m) => m.san));
    expect(imported.variant).toBe('standard');
  });

  it('round-trips a from-position game with SetUp/FEN headers', () => {
    const fen = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
    const g = new VariantGame({ variant: 'custom', fen });
    g.move({ from: 'e1', to: 'g1' });
    g.move({ from: 'e8', to: 'c8' });
    const pgn = exportPgn({ startFen: fen, variant: 'custom', moves: g.history() });
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain(`[FEN "${fen}"]`);
    const imported = importPgn(pgn);
    expect(imported.startFen).toBe(fen);
    expect(imported.moves.map((m) => m.san)).toEqual(['O-O', 'O-O-O']);
  });

  it('round-trips a chess960 game including castling SAN', () => {
    const fen = '1rk2r2/pppppppp/8/8/8/8/PPPPPPPP/1RK2R2 w KQkq - 0 1';
    const g = new VariantGame({ variant: 'chess960', fen });
    g.move({ from: 'c1', to: 'f1' }); // O-O
    g.move({ from: 'g7', to: 'g6' });
    const pgn = exportPgn({ startFen: fen, variant: 'chess960', moves: g.history() });
    expect(pgn).toContain('[Variant "Chess960"]');
    const imported = importPgn(pgn);
    expect(imported.variant).toBe('chess960');
    expect(imported.moves[0].san).toBe('O-O');
    expect(imported.moves[0].uci).toBe('c1f1');
  });

  it('imports PGNs with comments, NAGs and a result', () => {
    const pgn = `[Event "Test"]\n[Result "1-0"]\n\n1. e4 {best by test} e5 $1 2. Nf3 1-0\n`;
    const imported = importPgn(pgn);
    expect(imported.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(imported.result).toBe('1-0');
  });
});
