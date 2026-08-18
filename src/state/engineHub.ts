import { StockfishEngine, type UciEngine } from '../lib/engine/uci';

/**
 * Central owner of Stockfish workers. At most two engine processes exist:
 * one for live play (HvE / EvE), one for analysis work (Analysis Lab, hints,
 * post-game passes). The analysis engine is guarded by a promise-chain mutex
 * so background analysis and the lab never talk over each other.
 */

let playEngine: StockfishEngine | null = null;
let analysisEngine: StockfishEngine | null = null;
let analysisLock: Promise<void> = Promise.resolve();

export function getPlayEngine(): UciEngine {
  playEngine ??= new StockfishEngine();
  return playEngine;
}

export function resetPlayEngine(): void {
  playEngine?.dispose();
  playEngine = null;
}

export function getAnalysisEngineRaw(): StockfishEngine {
  analysisEngine ??= new StockfishEngine();
  return analysisEngine;
}

/**
 * Run `fn` with exclusive access to the analysis engine. Always stops any
 * search left running by the previous holder before handing over.
 */
export function withAnalysisEngine<T>(fn: (engine: StockfishEngine) => Promise<T>): Promise<T> {
  const run = analysisLock.then(async () => {
    const engine = getAnalysisEngineRaw();
    engine.stop();
    await engine.ready();
    return fn(engine);
  });
  analysisLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function disposeAllEngines(): void {
  playEngine?.dispose();
  playEngine = null;
  analysisEngine?.dispose();
  analysisEngine = null;
}
