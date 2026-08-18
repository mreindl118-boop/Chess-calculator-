import { Chess } from 'chess.js';
import { VariantGame } from './variantGame';
import { START_FEN, type ChessVariant, type RecordedMove } from './types';

export interface PgnHeaders {
  event?: string;
  site?: string;
  date?: string;
  white?: string;
  black?: string;
  result?: string;
  variant?: ChessVariant;
  whiteElo?: number;
  blackElo?: number;
  timeControl?: string;
  [key: string]: string | number | undefined;
}

function pgnDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

const VARIANT_TAG: Record<ChessVariant, string | undefined> = {
  standard: undefined,
  chess960: 'Chess960',
  'rbc-chaos': 'Really Bad Chess (Chaos)',
  'rbc-handicap': 'Really Bad Chess (Handicap)',
  custom: 'From Position',
};

/** Export a finished or in-progress game to PGN. Works for every variant. */
export function exportPgn(opts: {
  startFen: string;
  variant: ChessVariant;
  moves: Pick<RecordedMove, 'san' | 'color'>[];
  headers?: PgnHeaders;
  result?: string;
}): string {
  const h = opts.headers ?? {};
  const result = opts.result ?? h.result ?? '*';
  const lines: string[] = [];
  const tag = (k: string, v: string | number | undefined) => {
    if (v !== undefined && v !== '') lines.push(`[${k} "${String(v).replace(/"/g, '\\"')}"]`);
  };
  tag('Event', h.event ?? 'GambitLab game');
  tag('Site', h.site ?? 'GambitLab');
  tag('Date', h.date ?? pgnDate());
  tag('White', h.white ?? 'White');
  tag('Black', h.black ?? 'Black');
  tag('Result', result);
  const variantTag = VARIANT_TAG[opts.variant];
  if (variantTag) tag('Variant', variantTag);
  if (opts.startFen !== START_FEN) {
    tag('SetUp', '1');
    tag('FEN', opts.startFen);
  }
  tag('WhiteElo', h.whiteElo);
  tag('BlackElo', h.blackElo);
  tag('TimeControl', h.timeControl);

  const startParts = opts.startFen.split(' ');
  let moveNo = parseInt(startParts[5], 10) || 1;
  let firstIsBlack = startParts[1] === 'b';

  const tokens: string[] = [];
  for (const m of opts.moves) {
    if (m.color === 'w') {
      tokens.push(`${moveNo}.`, m.san);
    } else {
      if (firstIsBlack) tokens.push(`${moveNo}...`);
      tokens.push(m.san);
      moveNo++;
    }
    firstIsBlack = false;
  }
  tokens.push(result);

  // Wrap the movetext at ~80 columns.
  const body: string[] = [];
  let line = '';
  for (const t of tokens) {
    if (line.length + t.length + 1 > 80) {
      body.push(line);
      line = t;
    } else {
      line = line ? `${line} ${t}` : t;
    }
  }
  if (line) body.push(line);

  return lines.join('\n') + '\n\n' + body.join('\n') + '\n';
}

export interface ImportedPgn {
  startFen: string;
  variant: ChessVariant;
  headers: Record<string, string>;
  moves: RecordedMove[];
  result?: string;
}

/**
 * Import a PGN (mainline only; variations and comments are ignored).
 * Standard and from-position games are supported; Chess960 PGNs replay as
 * long as the movetext uses standard SAN with O-O/O-O-O castling.
 */
export function importPgn(pgn: string): ImportedPgn {
  const headers: Record<string, string> = {};
  const headerRe = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(pgn))) headers[m[1]] = m[2].replace(/\\"/g, '"');

  const startFen = headers.FEN && headers.SetUp !== '0' ? headers.FEN : START_FEN;
  const variantHeader = (headers.Variant ?? '').toLowerCase();
  const variant: ChessVariant = variantHeader.includes('960')
    ? 'chess960'
    : startFen !== START_FEN
      ? 'custom'
      : 'standard';

  // chess.js handles standard PGNs (incl. comments/NAG stripping) natively;
  // for 960 we tokenize and replay through VariantGame.
  const moves: RecordedMove[] = [];
  if (variant !== 'chess960') {
    const chess = new Chess();
    chess.loadPgn(pgn); // throws on malformed input
    const verbose = chess.history({ verbose: true });
    const game = new VariantGame({
      variant: startFen === START_FEN ? 'standard' : 'custom',
      fen: startFen,
    });
    for (const v of verbose) {
      const rec = game.move({ from: v.from, to: v.to, promotion: v.promotion as any });
      if (!rec) throw new Error(`illegal move in PGN: ${v.san}`);
      moves.push(rec);
    }
  } else {
    const body = pgn
      .replace(headerRe, ' ')
      .replace(/\{[^}]*\}/g, ' ') // comments
      .replace(/;[^\n]*/g, ' ')
      .replace(/\$\d+/g, ' '); // NAGs
    const tokens = stripVariations(body)
      .split(/\s+/)
      .filter(Boolean)
      .filter((t) => !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t))
      .map((t) => t.replace(/^\d+\.+/, ''));
    const game = new VariantGame({ variant: 'chess960', fen: startFen });
    for (const t of tokens) {
      const rec = playSan(game, t);
      if (!rec) throw new Error(`illegal move in PGN: ${t}`);
      moves.push(rec);
    }
  }

  return {
    startFen,
    variant,
    headers,
    moves,
    result: headers.Result && headers.Result !== '*' ? headers.Result : undefined,
  };
}

function playSan(game: VariantGame, san: string): RecordedMove | null {
  const clean = san.replace(/[+#!?]+$/, '');
  for (const mv of game.moves()) {
    const rec = game.move(mv);
    if (!rec) continue;
    if (rec.san.replace(/[+#]+$/, '') === clean) return rec;
    game.undo();
  }
  return null;
}

function stripVariations(text: string): string {
  let out = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}
