import type { ChessVariant, PieceSymbol, Square } from '../chess/types';
import {
  MAGNITUDE_MIN,
  findSacrifices,
  pvMateForMover,
  pvToSanLine,
  type Magnitude,
  type SacCandidate,
} from '../chess/see';
import type { UciEngine } from './uci';

/**
 * Brilliant Moves — the sacrifice-to-forced-mate hunter.
 *
 * All of the mode's tunables live in one config object here, beside the Elo
 * calibration module, so horizon / budget / magnitude behaviour is adjusted in
 * a single place. The hard rule the whole mode enforces: a sacrifice is only
 * ever surfaced when the engine proves a forced checkmate for the sacrificing
 * side AND chess.js confirms the reported line actually ends in mate. No mate
 * proof, no line.
 */

export interface BrilliantConfig {
  /** longest mate we will accept / prove (moves) */
  mateHorizon: number;
  /** total engine time for one hunt across all candidates (ms) */
  budgetMs: number;
  /** most candidates fed to one MultiPV hunt search */
  multipvCap: number;
  /** primary MultiPV analysis reaches this depth before a hunt is allowed to run */
  baselineDepth: number;
  /** how long a position must sit still before a hunt starts (ms) */
  debounceMs: number;
  /** how long to wait for the baseline before hunting anyway (ms) */
  baselineWaitMs: number;
}

export const BRILLIANT_CONFIG: BrilliantConfig = {
  mateHorizon: 12,
  budgetMs: 4000,
  multipvCap: 12,
  baselineDepth: 14,
  debounceMs: 350,
  baselineWaitMs: 1500,
};

export interface BrilliantLine {
  /** UCI of the sacrifice move */
  uci: string;
  from: Square;
  to: Square;
  san: string;
  /** invested material in pawns */
  invested: number;
  tier: Magnitude;
  movedType: PieceSymbol;
  /** forced mate distance in moves */
  mateIn: number;
  /** full forced line as UCI */
  pv: string[];
  /** full forced line as SAN, for display / click-to-step */
  sanLine: string[];
}

/** Human chip label for a sacrifice, e.g. "Queen sac −9". */
export function sacLabel(movedType: PieceSymbol, invested: number): string {
  const name =
    movedType === 'q'
      ? 'Queen'
      : movedType === 'r'
        ? 'Rook'
        : movedType === 'b'
          ? 'Bishop'
          : movedType === 'n'
            ? 'Knight'
            : movedType === 'p'
              ? 'Pawn'
              : 'Piece';
  return `${name} sac −${invested}`;
}

/**
 * Run one bounded MultiPV hunt over the sacrifice candidates and return only
 * the mate-verified lines, ranked by invested material desc then mate distance
 * asc (flashiest proven sac first).
 *
 * We restrict the root to the candidate moves via `searchmoves` and size
 * MultiPV to the candidate count, so a single bounded search evaluates every
 * candidate at once — strictly fewer worker round-trips than N per-candidate
 * `go mate N` probes, and the mate scores surface within the same search. Each
 * accepted PV must carry a mate score for the mover within the horizon AND be
 * confirmed by chess.js to end in checkmate.
 */
export async function huntBrilliant(
  engine: UciEngine,
  params: {
    fen: string;
    variant: ChessVariant;
    candidates: SacCandidate[];
    magnitudeMin: Magnitude;
    config?: Partial<BrilliantConfig>;
  },
): Promise<BrilliantLine[]> {
  const cfg = { ...BRILLIANT_CONFIG, ...params.config };
  const min = MAGNITUDE_MIN[params.magnitudeMin];
  const cands = params.candidates
    .filter((c) => c.invested >= min)
    .slice(0, cfg.multipvCap);
  if (cands.length === 0) return [];

  engine.setOption('MultiPV', cands.length);
  engine.setOption('UCI_LimitStrength', false);
  engine.setOption('Skill Level', 20);
  engine.setOption('UCI_Chess960', params.variant === 'chess960');
  engine.position(params.fen);

  const result = await engine.go({
    movetime: cfg.budgetMs,
    searchmoves: cands.map((c) => c.uci),
  });

  const byUci = new Map<string, SacCandidate>();
  for (const c of cands) {
    byUci.set(c.uci, c);
    byUci.set(c.uci.slice(0, 4), c); // promotion-insensitive fallback
  }

  const found: BrilliantLine[] = [];
  for (const info of result.lines.values()) {
    if (info.scoreMate === undefined || info.scoreMate <= 0) continue;
    if (info.scoreMate > cfg.mateHorizon) continue;
    const firstUci = info.pv[0];
    if (!firstUci) continue;
    const cand = byUci.get(firstUci) ?? byUci.get(firstUci.slice(0, 4));
    if (!cand) continue;
    // Hard gate: chess.js must confirm the PV really ends in mate by the mover.
    const mateIn = pvMateForMover(params.fen, info.pv);
    if (mateIn === null || mateIn > cfg.mateHorizon) continue;
    found.push({
      uci: cand.uci,
      from: cand.from,
      to: cand.to,
      san: cand.san,
      invested: cand.invested,
      tier: cand.tier,
      movedType: cand.movedType,
      mateIn,
      pv: info.pv,
      sanLine: pvToSanLine(params.fen, info.pv) ?? [],
    });
  }
  found.sort((a, b) => b.invested - a.invested || a.mateIn - b.mateIn);
  return found;
}

/**
 * Post-game classifier tie-in (pure): a played move is Brilliant (!!) when it
 * meets the sacrifice definition AND the position after it is a forced mate for
 * the mover. Reuses the exact same detector as the live hunt.
 */
export function isBrilliantPlayed(
  beforeFen: string,
  playedUci: string,
  mateForMoverAfter: boolean,
  magnitudeMin: Magnitude = 'spicy',
): boolean {
  if (!mateForMoverAfter) return false;
  const min = MAGNITUDE_MIN[magnitudeMin];
  const key = playedUci.slice(0, 4);
  return findSacrifices(beforeFen).some(
    (s) => (s.uci === playedUci || s.uci.slice(0, 4) === key) && s.invested >= min,
  );
}
