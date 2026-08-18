import { create } from 'zustand';

export type View =
  | 'home'
  | 'play'
  | 'checkers'
  | 'analysis'
  | 'library'
  | 'stats'
  | 'puzzles'
  | 'settings';

interface NavState {
  view: View;
  /** optional payload, e.g. a game id for the analysis lab */
  params: Record<string, string>;
  stack: Array<{ view: View; params: Record<string, string> }>;
  go: (view: View, params?: Record<string, string>) => void;
  back: () => boolean;
}

export const useNav = create<NavState>((set, get) => ({
  view: 'home',
  params: {},
  stack: [],
  go: (view, params = {}) => {
    const { view: cur, params: curParams, stack } = get();
    if (view === cur) {
      set({ params });
      return;
    }
    set({ view, params, stack: [...stack, { view: cur, params: curParams }].slice(-20) });
  },
  back: () => {
    const { stack } = get();
    const prev = stack[stack.length - 1];
    if (!prev) return false;
    set({ view: prev.view, params: prev.params, stack: stack.slice(0, -1) });
    return true;
  },
}));
