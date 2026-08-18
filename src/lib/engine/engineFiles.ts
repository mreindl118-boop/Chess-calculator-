/**
 * Stockfish build filenames as copied by scripts/copy-engine.mjs.
 * The multi-threaded build needs crossOriginIsolated (COOP/COEP headers);
 * the single-threaded build is the universal fallback.
 */
export const ENGINE_MULTI = '/engine/stockfish-17.1-lite-51f59da.js';
export const ENGINE_SINGLE = '/engine/stockfish-17.1-lite-single-03e3232.js';

export function engineScriptUrl(): string {
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  return isolated ? ENGINE_MULTI : ENGINE_SINGLE;
}

export function engineThreads(): number {
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  if (!isolated) return 1;
  const hw = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 2;
  // Two engine processes can search concurrently (play + analysis) and the
  // UI thread must never starve — cap each engine at 2 threads.
  return Math.max(1, Math.min(2, hw - 2));
}
