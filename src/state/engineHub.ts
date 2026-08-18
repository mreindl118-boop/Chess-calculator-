import { ENGINE_MULTI, ENGINE_SINGLE, engineThreads } from '../lib/engine/engineFiles';
import { StockfishEngine, type UciEngine } from '../lib/engine/uci';
import { useSettings } from './settingsStore';

/**
 * Central owner of Stockfish workers. At most two engine processes exist:
 * one for live play (HvE / EvE), one for analysis work (Analysis Lab, hints,
 * post-game passes). The analysis engine is guarded by a promise-chain mutex
 * so background analysis and the lab never talk over each other.
 *
 * IMPORTANT: running more than one *multi-threaded* Stockfish instance per
 * page makes pthread helper-worker spawns fail under load and emscripten
 * retry-storms (hundreds of dead workers, everything wedged). So only the
 * analysis engine ever uses the multi-threaded build; the play engine — which
 * is strength-limited in every mode — always runs the single-threaded build
 * (no pthreads at all). warmUpEngines() additionally boots them one at a
 * time at app start, and late creation stops the sibling's search first.
 */

let playEngine: StockfishEngine | null = null;
let analysisEngine: StockfishEngine | null = null;
let analysisLock: Promise<void> = Promise.resolve();

export function getPlayEngine(): UciEngine {
  if (!playEngine) {
    analysisEngine?.stop();
    playEngine = new StockfishEngine(ENGINE_SINGLE, 1);
  }
  return playEngine;
}

export function resetPlayEngine(): void {
  playEngine?.dispose();
  playEngine = null;
}

export function getAnalysisEngineRaw(): StockfishEngine {
  if (!analysisEngine) {
    playEngine?.stop();
    const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
    const threaded = isolated && useSettings.getState().threadedEngine;
    analysisEngine = threaded
      ? new StockfishEngine(ENGINE_MULTI, engineThreads())
      : new StockfishEngine(ENGINE_SINGLE, 1);
  }
  return analysisEngine;
}

/** Dispose the analysis engine so the next use re-creates it (e.g. after the threaded-engine toggle changes). */
export function resetAnalysisEngine(): void {
  analysisEngine?.dispose();
  analysisEngine = null;
}

/** Create and warm both engines, strictly one after the other. */
export async function warmUpEngines(): Promise<void> {
  try {
    await (getPlayEngine() as StockfishEngine).ready();
    await getAnalysisEngineRaw().ready();
  } catch {
    // engine startup failure is non-fatal for the UI shell
  }
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
