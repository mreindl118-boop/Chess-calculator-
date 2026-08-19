/**
 * Stockfish build filenames as copied by scripts/copy-engine.mjs.
 * The multi-threaded build needs crossOriginIsolated (COOP/COEP headers);
 * the single-threaded build is the universal fallback.
 */
const BASE = typeof import.meta.env !== 'undefined' ? (import.meta.env.BASE_URL ?? '/') : '/';

/** Single-file (artifact) builds inject a blob URL for the engine worker. */
function engineOverride(): string | undefined {
  return (globalThis as { __GAMBITLAB_ENGINE_URL__?: string }).__GAMBITLAB_ENGINE_URL__;
}

export const ENGINE_MULTI = `${BASE}engine/stockfish-17.1-lite-51f59da.js`;
export const ENGINE_SINGLE = `${BASE}engine/stockfish-17.1-lite-single-03e3232.js`;

export function engineSingleUrl(): string {
  return engineOverride() ?? ENGINE_SINGLE;
}
export function engineMultiUrl(): string {
  return engineOverride() ?? ENGINE_MULTI;
}

export function engineScriptUrl(): string {
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  return isolated && !engineOverride() ? ENGINE_MULTI : engineSingleUrl();
}

export function engineThreads(): number {
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  if (!isolated) return 1;
  const hw = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 2;
  // Two engine processes can search concurrently (play + analysis) and the
  // UI thread must never starve — cap each engine at 2 threads.
  return Math.max(1, Math.min(2, hw - 2));
}
