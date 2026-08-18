import { mulberry32, randomSeed, type Rng } from '../util/rng';
import { settingsForElo, type EloSettings } from './calibration';
import type { EngineInfo, SearchLimits, UciEngine } from './uci';

/**
 * Wraps a UciEngine as an opponent playing at a target Elo.
 * Above the UCI_Elo floor this is plain limit-strength play; below it, the
 * engine searches with MultiPV under hard depth/node caps and the move is
 * drawn from the candidate lines with weights biased toward weaker moves as
 * the target drops.
 */
export class EnginePlayer {
  readonly settings: EloSettings;
  private rng: Rng;
  private configured = false;

  constructor(
    private engine: UciEngine,
    targetElo: number,
    seed?: number,
  ) {
    this.settings = settingsForElo(targetElo);
    this.rng = mulberry32(seed ?? randomSeed());
  }

  private async configure(): Promise<void> {
    await this.engine.ready();
    const s = this.settings;
    if (s.uciElo !== undefined) {
      this.engine.setOption('UCI_LimitStrength', true);
      this.engine.setOption('UCI_Elo', s.uciElo);
      this.engine.setOption('MultiPV', 1);
      this.engine.setOption('Skill Level', 20);
    } else if (s.skill !== undefined) {
      this.engine.setOption('UCI_LimitStrength', false);
      this.engine.setOption('Skill Level', s.skill);
      this.engine.setOption('MultiPV', s.blend?.multipv ?? 1);
    } else {
      this.engine.setOption('UCI_LimitStrength', false);
      this.engine.setOption('Skill Level', 20);
      this.engine.setOption('MultiPV', 1);
    }
    this.configured = true;
  }

  set960(enabled: boolean): void {
    this.engine.setOption('UCI_Chess960', enabled);
  }

  /** Choose a move for the given position. */
  async pickMove(
    fen: string,
    moves: string[],
    onInfo?: (info: EngineInfo) => void,
  ): Promise<string> {
    if (!this.configured) await this.configure();
    const s = this.settings;
    this.engine.position(fen, moves);

    const limits: SearchLimits = { movetime: s.movetime };
    if (s.depthCap !== undefined) limits.depth = s.depthCap;
    if (s.nodesCap !== undefined) limits.nodes = s.nodesCap;

    const result = await this.engine.go(limits, onInfo);

    if (!s.blend) return result.bestmove;

    // Collect the final candidate lines, best first.
    const candidates = [...result.lines.values()]
      .filter((l) => l.pv.length > 0)
      .sort((a, b) => a.multipv - b.multipv);
    if (candidates.length <= 1) return result.bestmove;

    const bestScore = scoreOf(candidates[0]);
    const eligible = candidates.filter((c) => bestScore - scoreOf(c) <= s.blend!.maxCpLoss);
    const weights = eligible.map((_, i) => Math.pow(s.blend!.temperature, i));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.rng() * total;
    for (let i = 0; i < eligible.length; i++) {
      r -= weights[i];
      if (r <= 0) return eligible[i].pv[0];
    }
    return result.bestmove;
  }

  stop(): void {
    this.engine.stop();
  }
}

function scoreOf(info: EngineInfo): number {
  if (info.scoreMate !== undefined) {
    return info.scoreMate > 0 ? 10000 - info.scoreMate : -10000 - info.scoreMate;
  }
  return info.scoreCp ?? 0;
}
