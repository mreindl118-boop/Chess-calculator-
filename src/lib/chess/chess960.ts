import { mulberry32, randInt, type Rng } from '../util/rng';

/**
 * Chess960 start positions using the standard numbering scheme (0-959).
 * Position 518 is the classical start.
 */
export function chess960BackRank(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 959) {
    throw new Error(`Chess960 position must be 0-959, got ${n}`);
  }
  const rank: (string | null)[] = new Array(8).fill(null);

  // Light-square bishop: files b, d, f, h
  const b1 = n % 4;
  n = Math.floor(n / 4);
  rank[b1 * 2 + 1] = 'b';

  // Dark-square bishop: files a, c, e, g
  const b2 = n % 4;
  n = Math.floor(n / 4);
  rank[b2 * 2] = 'b';

  // Queen in one of the 6 remaining squares
  const q = n % 6;
  n = Math.floor(n / 6);
  let empty = -1;
  for (let i = 0; i < 8; i++) {
    if (rank[i] === null) {
      empty++;
      if (empty === q) {
        rank[i] = 'q';
        break;
      }
    }
  }

  // Knights: N5N table over the remaining 5 squares
  const knightTable = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [1, 2],
    [1, 3],
    [1, 4],
    [2, 3],
    [2, 4],
    [3, 4],
  ];
  const [k1, k2] = knightTable[n];
  const free: number[] = [];
  for (let i = 0; i < 8; i++) if (rank[i] === null) free.push(i);
  rank[free[k1]] = 'n';
  rank[free[k2]] = 'n';

  // Remaining three squares: rook, king, rook (king always between rooks)
  const rest = [];
  for (let i = 0; i < 8; i++) if (rank[i] === null) rest.push(i);
  rank[rest[0]] = 'r';
  rank[rest[1]] = 'k';
  rank[rest[2]] = 'r';

  return rank.join('');
}

export function chess960Fen(n: number): string {
  const back = chess960BackRank(n);
  // Castling encoded as '-' in the FEN we feed chess.js; VariantGame owns 960
  // castling rights itself (see castling960.ts).
  return `${back}/pppppppp/8/8/8/8/PPPPPPPP/${back.toUpperCase()} w - - 0 1`;
}

export function randomChess960Position(seed?: number): { n: number; fen: string } {
  const rng: Rng = mulberry32(seed ?? ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0));
  const n = randInt(rng, 960);
  return { n, fen: chess960Fen(n) };
}

/** Rook starting files for each side of the king, given a 960 back rank. */
export function rookFilesOf(backRank: string): { kingFile: number; aRook: number; hRook: number } {
  const kingFile = backRank.indexOf('k');
  let aRook = -1;
  let hRook = -1;
  for (let i = 0; i < 8; i++) {
    if (backRank[i] === 'r') {
      if (i < kingFile) aRook = i;
      else hRook = i;
    }
  }
  return { kingFile, aRook, hRook };
}
