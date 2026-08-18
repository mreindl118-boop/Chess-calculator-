import { create } from 'zustand';
import { kvGet, kvSet } from '../lib/db/schema';
import { setSoundEnabled } from '../lib/audio/sounds';
import { setHapticsEnabled } from '../lib/platform/haptics';

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
  autoFlipPvP: boolean;
  evalBar: boolean;
  coordinates: boolean;
}

const DEFAULTS: Settings = {
  boardTheme: 'midnight',
  pieceStyle: 'classic',
  darkMode: true,
  sound: true,
  haptics: true,
  legalDots: true,
  premove: true,
  autoFlipPvP: false,
  evalBar: true,
  coordinates: true,
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
    const stored = await kvGet<Partial<Settings>>('settings');
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
    legalDots, premove, autoFlipPvP, evalBar, coordinates,
  } = s;
  return {
    boardTheme, pieceStyle, darkMode, sound, haptics,
    legalDots, premove, autoFlipPvP, evalBar, coordinates,
  };
}

function applyDarkMode(dark: boolean): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
}
