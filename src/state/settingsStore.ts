import { create } from 'zustand';
import { kvGet, kvSet } from '../lib/db/schema';
import { setSoundEnabled } from '../lib/audio/sounds';
import { setHapticsEnabled } from '../lib/platform/haptics';
import type { Magnitude } from '../lib/chess/see';

export type BoardTheme = 'midnight' | 'walnut' | 'forest';
export type PieceStyle = 'classic' | 'minimal';

export interface Settings {
  boardTheme: BoardTheme;
  pieceStyle: PieceStyle;
  darkMode: boolean;
  sound: boolean;
  haptics: boolean;
  legalDots: boolean;
  premove: boolean;
  /**
   * Keep the side to move at the bottom of the board — in pass & play
   * (chess and checkers) and in the Calculator — so the viewer always sees
   * the position from the moving player's perspective. Games against the
   * engine always stay from the human's side.
   */
  autoFlip: boolean;
  evalBar: boolean;
  coordinates: boolean;
  /**
   * Use the multi-threaded Stockfish build for analysis (needs
   * crossOriginIsolated). Off by default: wasm pthread spawning is unstable
   * in some Chromium environments and a failure can wedge the page; the
   * engine self-heals onto the single-threaded build when it detects that,
   * but reliability-first is the default. Takes effect for the next analysis.
   */
  threadedEngine: boolean;
  /**
   * Brilliant Moves: hunt sacrifices that force checkmate and surface them in
   * the Calculator. Off by default (it costs an extra bounded engine pass).
   */
  brilliant: boolean;
  /** minimum sacrifice magnitude to hunt/show: spicy (minor) / unhinged (rook) / psychotic (queen) */
  brilliantMin: Magnitude;
}

const DEFAULTS: Settings = {
  boardTheme: 'midnight',
  pieceStyle: 'classic',
  darkMode: true,
  sound: true,
  haptics: true,
  legalDots: true,
  premove: true,
  autoFlip: true,
  evalBar: true,
  coordinates: true,
  threadedEngine: false,
  brilliant: false,
  brilliantMin: 'spicy',
};

interface SettingsState extends Settings {
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  loaded: false,
  load: async () => {
    const stored = await kvGet<Partial<Settings> & { autoFlipPvP?: boolean }>('settings');
    // migrate the old pass&play-only flip flag to the app-wide setting
    if (stored && stored.autoFlip === undefined && stored.autoFlipPvP !== undefined) {
      stored.autoFlip = stored.autoFlipPvP;
    }
    const merged = { ...DEFAULTS, ...(stored ?? {}) };
    setSoundEnabled(merged.sound);
    setHapticsEnabled(merged.haptics);
    applyDarkMode(merged.darkMode);
    set({ ...merged, loaded: true });
  },
  update: (patch) => {
    const next = { ...pick(get()), ...patch };
    if (patch.sound !== undefined) setSoundEnabled(patch.sound);
    if (patch.haptics !== undefined) setHapticsEnabled(patch.haptics);
    if (patch.darkMode !== undefined) applyDarkMode(patch.darkMode);
    set(patch);
    void kvSet('settings', next);
  },
}));

function pick(s: SettingsState): Settings {
  const {
    boardTheme, pieceStyle, darkMode, sound, haptics,
    legalDots, premove, autoFlip, evalBar, coordinates, threadedEngine,
    brilliant, brilliantMin,
  } = s;
  return {
    boardTheme, pieceStyle, darkMode, sound, haptics,
    legalDots, premove, autoFlip, evalBar, coordinates, threadedEngine,
    brilliant, brilliantMin,
  };
}

function applyDarkMode(dark: boolean): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
}
