import { describe, expect, it } from 'vitest';
import { VariantGame } from '../../src/lib/chess/variantGame';
import { START_FEN } from '../../src/lib/chess/types';

describe('standard chess rules', () => {
  it('plays a full scholars mate with SAN/uci records', () => {
    const g = new VariantGame({ variant: 'standard' });
    const moves = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];
    for (const m of moves) expect(g.move(m)).not.toBeNull();
    expect(g.isCheckmate()).toBe(true);
    expect(g.gameOver()).toMatchObject({ over: true, result: '1-0', reason: 'checkmate' });
    expect(g.lastMove()!.san).toBe('Qxf7#');
  });

  it('handles castling both sides', () => {
    const g = new VariantGame({
      variant: 'custom',
      fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
    });
    const wk = g.move({ from: 'e1', to: 'g1' });
    expect(wk?.castle).toBe('k');
    expect(g.get('f1')?.type).toBe('r');
    const bq = g.move({ from: 'e8', to: 'c8' });
    expect(bq?.castle).toBe('q');
    expect(g.get('d8')?.type).toBe('r');
  });

  it('forbids castling through check', () => {
    const g = new VariantGame({
      variant: 'custom',
      fen: '4k3/8/8/8/8/5r2/8/R3K2R w KQ - 0 1', // f-rook covers f1
    });
    expect(g.moves({ square: 'e1' }).some((m) => m.to === 'g1')).toBe(false);
    expect(g.moves({ square: 'e1' }).some((m) => m.to === 'c1')).toBe(true);
  });

  it('handles en passant, including records', () => {
    const g = new VariantGame({ variant: 'standard' });
    for (const m of ['e2e4', 'a7a6', 'e4e5', 'd7d5']) g.move(m);
    const ep = g.move({ from: 'e5', to: 'd6' });
    expect(ep?.isEnPassant).toBe(true);
    expect(g.get('d5')).toBeUndefined();
  });

  it('requires and applies promotion', () => {
    const g = new VariantGame({ variant: 'custom', fen: '8/P6k/8/8/8/8/8/K7 w - - 0 1' });
    expect(g.needsPromotion('a7', 'a8')).toBe(true);
    expect(g.move({ from: 'a7', to: 'a8' })).toBeNull(); // promotion piece missing
    const m = g.move({ from: 'a7', to: 'a8', promotion: 'q' });
    expect(m?.promotion).toBe('q');
    expect(g.get('a8')?.type).toBe('q');
  });

  it('detects stalemate', () => {
    const g = new VariantGame({ variant: 'custom', fen: 'k7/8/1Q6/8/8/8/8/K7 b - - 0 1' });
    expect(g.isStalemate()).toBe(true);
    expect(g.gameOver()).toMatchObject({ over: true, result: '1/2-1/2', reason: 'stalemate' });
  });

  it('detects threefold repetition across shuffles', () => {
    const g = new VariantGame({ variant: 'standard' });
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    for (const m of shuffle) g.move(m);
    expect(g.isThreefoldRepetition()).toBe(false); // start seen twice
    for (const m of shuffle) g.move(m);
    expect(g.isThreefoldRepetition()).toBe(true); // start seen three times
  });

  it('undo restores repetition counts', () => {
    const g = new VariantGame({ variant: 'standard' });
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    for (const m of shuffle) g.move(m);
    for (const m of shuffle) g.move(m);
    expect(g.isThreefoldRepetition()).toBe(true);
    g.undo();
    expect(g.isThreefoldRepetition()).toBe(false);
    g.move('f6g8');
    expect(g.isThreefoldRepetition()).toBe(true);
  });

  it('detects the fifty-move rule from the FEN clock', () => {
    const g = new VariantGame({ variant: 'custom', fen: '4k3/8/8/8/8/8/4K3/7R w - - 99 80' });
    expect(g.isFiftyMoves()).toBe(false);
    g.move({ from: 'e2', to: 'e3' });
    expect(g.isFiftyMoves()).toBe(true);
    expect(g.gameOver().reason).toBe('fifty-move');
  });

  it('detects insufficient material (K vs K+B)', () => {
    const g = new VariantGame({ variant: 'custom', fen: '4k3/8/8/8/8/8/4KB2/8 w - - 0 1' });
    expect(g.isInsufficientMaterial()).toBe(true);
  });

  it('fifty-move counter resets on pawn moves and captures', () => {
    const g = new VariantGame({ variant: 'standard' });
    g.move('g1f3');
    expect(g.halfmoveClock()).toBe(1);
    g.move('e7e5');
    expect(g.halfmoveClock()).toBe(0);
    g.move('f3e5');
    expect(g.halfmoveClock()).toBe(0);
  });
});

describe('undo', () => {
  it('fully restores position and history', () => {
    const g = new VariantGame({ variant: 'standard' });
    g.move('e2e4');
    const fenAfterE4 = g.fen();
    g.move('c7c5');
    g.undo();
    expect(g.fen()).toBe(fenAfterE4);
    expect(g.history().length).toBe(1);
    g.undo();
    expect(g.fen()).toBe(START_FEN);
    expect(g.undo()).toBeNull();
  });
});
