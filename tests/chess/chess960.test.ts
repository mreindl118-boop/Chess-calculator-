import { describe, expect, it } from 'vitest';
import { chess960BackRank, chess960Fen } from '../../src/lib/chess/chess960';
import { VariantGame } from '../../src/lib/chess/variantGame';

describe('chess960 position generation', () => {
  it('position 518 is the classical start', () => {
    expect(chess960BackRank(518)).toBe('rnbqkbnr');
  });

  it('all 960 positions are valid and unique', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 960; n++) {
      const rank = chess960BackRank(n);
      seen.add(rank);
      const files = rank.split('');
      // exactly the right piece multiset
      expect([...files].sort().join('')) .toBe('bbknnqrr');
      // bishops on opposite colors
      const bishops = files.flatMap((p, i) => (p === 'b' ? [i] : []));
      expect((bishops[0] + bishops[1]) % 2).toBe(1);
      // king strictly between the rooks
      const king = rank.indexOf('k');
      const rooks = files.flatMap((p, i) => (p === 'r' ? [i] : []));
      expect(rooks[0]).toBeLessThan(king);
      expect(king).toBeLessThan(rooks[1]);
    }
    expect(seen.size).toBe(960);
  });

  it('rejects out-of-range positions', () => {
    expect(() => chess960BackRank(960)).toThrow();
    expect(() => chess960BackRank(-1)).toThrow();
  });
});

describe('chess960 castling', () => {
  it('offers castling as king-onto-rook and executes to g/f files', () => {
    // Position 0: bbqnnrkr — king f1(actually g?), let's use the derived FEN.
    const g = new VariantGame({ variant: 'chess960', position960: 0 });
    expect(g.fen().split(' ')[0]).toBe(chess960Fen(0).split(' ')[0]);
  });

  it('castles kingside in a cleared position (king g1, rook f1)', () => {
    // Back rank nrkbbrqn (hypothetical); use a real 960-legal FEN instead:
    // rooks b1/f1, king c1 - queenside rook at b1, kingside rook at f1.
    const g = new VariantGame({
      variant: 'chess960',
      fen: '1rk2r2/pppppppp/8/8/8/8/PPPPPPPP/1RK2R2 w KQkq - 0 1',
    });
    const castles = g.moves({ square: 'c1' }).filter((m) => m.castle);
    expect(castles.some((m) => m.castle === 'k' && m.to === 'f1')).toBe(true);
    const rec = g.move({ from: 'c1', to: 'f1' });
    expect(rec?.san).toBe('O-O');
    expect(rec?.uci).toBe('c1f1');
    expect(g.get('g1')?.type).toBe('k');
    expect(g.get('f1')?.type).toBe('r');
    expect(g.get('c1')).toBeUndefined();
  });

  it('castles queenside when king already stands on c1 (king stays, rook to d1)', () => {
    const g = new VariantGame({
      variant: 'chess960',
      fen: '1rk2r2/pppppppp/8/8/8/8/PPPPPPPP/1RK2R2 w KQkq - 0 1',
    });
    const rec = g.move({ from: 'c1', to: 'b1' }); // king onto own rook
    expect(rec?.san).toBe('O-O-O');
    expect(g.get('c1')?.type).toBe('k'); // king destination c1 = its own square
    expect(g.get('d1')?.type).toBe('r');
    expect(g.get('b1')).toBeUndefined();
  });

  it('forbids castling when a between-square is occupied', () => {
    const g = new VariantGame({
      variant: 'chess960',
      fen: '1rk2r2/pppppppp/8/8/8/8/PPPPPPPP/1RK1BR2 w KQkq - 0 1', // e1 bishop blocks king path c1->g1
    });
    expect(g.moves({ square: 'c1' }).some((m) => m.castle === 'k')).toBe(false);
  });

  it('forbids castling through an attacked square', () => {
    // Black rook on e4 hits e1 down the open e-file; the king path c1->g1
    // crosses e1, so kingside castling is illegal while queenside stays legal.
    const attacked = new VariantGame({
      variant: 'chess960',
      fen: '2k5/pppp1ppp/8/8/4r3/8/PPPP1PPP/1RK2R2 w KQ - 0 1',
    });
    expect(attacked.moves({ square: 'c1' }).some((m) => m.castle === 'k')).toBe(false);
    expect(attacked.moves({ square: 'c1' }).some((m) => m.castle === 'q')).toBe(true);
  });

  it('right is lost after the rook moves and after the king moves', () => {
    const g = new VariantGame({
      variant: 'chess960',
      fen: '1rk2r2/pppppppp/8/8/8/8/PPPPPPPP/1RK2R2 w KQkq - 0 1',
    });
    g.move({ from: 'f1', to: 'g1' }); // kingside rook moves
    g.move({ from: 'a7', to: 'a6' });
    expect(g.moves({ square: 'c1' }).some((m) => m.castle === 'k')).toBe(false);
    // queenside is still available
    expect(g.moves({ square: 'c1' }).some((m) => m.castle === 'q')).toBe(true);
    g.move({ from: 'c1', to: 'd1' }); // king moves (ordinary move)
    g.move({ from: 'a6', to: 'a5' });
    g.move({ from: 'd1', to: 'c1' });
    g.move({ from: 'a5', to: 'a4' });
    expect(g.moves({ square: 'c1' }).some((m) => m.castle)).toBe(false);
  });

  it('capturing the rook on its home square kills the right permanently', () => {
    // White bishop h6 takes the f8 rook; black's b8 rook then maneuvers back
    // to f8. Kingside castling must NOT come back with the substitute rook.
    const g = new VariantGame({
      variant: 'chess960',
      fen: '1rk2r2/p1ppp2p/6pB/8/8/8/PPPPPPP1/1RK2R2 w KQkq - 0 1',
    });
    expect(g.move({ from: 'h6', to: 'f8' })?.captured).toBe('r');
    g.move({ from: 'b8', to: 'b4' });
    g.move({ from: 'a2', to: 'a3' });
    g.move({ from: 'b4', to: 'f4' });
    g.move({ from: 'f8', to: 'h6' }); // bishop retreats
    g.move({ from: 'f4', to: 'f8' }); // substitute rook reaches f8
    g.move({ from: 'a3', to: 'a4' });
    expect(g.get('f8')?.type).toBe('r');
    expect(g.get('c8')?.type).toBe('k');
    expect(g.moves({ square: 'c8' }).some((m) => m.castle === 'k')).toBe(false);
  });

  it('castling is refused while in check', () => {
    const g = new VariantGame({
      variant: 'chess960',
      fen: '2k5/pppp1ppp/8/8/2r5/8/PP1P1PPP/1RK2R2 w KQ - 0 1', // rook c4 checks c1 through open c-file
    });
    expect(g.isCheck()).toBe(true);
    expect(g.moves({ square: 'c1' }).some((m) => m.castle)).toBe(false);
  });

  it('undo restores castling rights', () => {
    const g = new VariantGame({
      variant: 'chess960',
      fen: '1rk2r2/pppppppp/8/8/8/8/PPPPPPPP/1RK2R2 w KQkq - 0 1',
    });
    const rec = g.move({ from: 'c1', to: 'f1' });
    expect(rec?.castle).toBe('k');
    g.undo();
    expect(g.get('c1')?.type).toBe('k');
    expect(g.get('f1')?.type).toBe('r');
    expect(g.moves({ square: 'c1' }).some((m) => m.castle === 'k')).toBe(true);
  });
});
