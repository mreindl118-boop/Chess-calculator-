import { create } from 'zustand';
import { db, freshPool, newId, type Profile, type RatingPool } from '../lib/db/schema';
import { updatedRating, type Score } from '../lib/rating/elo';

export const AVATAR_COLORS = [
  '#e5734c', '#4c9de5', '#57b26a', '#b061d8', '#d8b93f', '#e05c7f', '#4cc7c0', '#8d8d95',
];

interface ProfilesState {
  profiles: Profile[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (name: string, avatarColor?: string) => Promise<Profile>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Apply a rated result to one profile's pool and persist. */
  applyRated: (
    id: string,
    pool: 'chess' | 'checkers',
    opponentRating: number,
    score: Score,
  ) => Promise<Profile | undefined>;
  byId: (id: string) => Profile | undefined;
}

export const useProfiles = create<ProfilesState>((set, get) => ({
  profiles: [],
  loaded: false,

  load: async () => {
    const all = await (await db()).getAll('profiles');
    set({ profiles: all.sort((a, b) => a.createdAt - b.createdAt), loaded: true });
  },

  create: async (name, avatarColor) => {
    const profile: Profile = {
      id: newId(),
      name: name.trim() || 'Player',
      avatarColor: avatarColor ?? AVATAR_COLORS[get().profiles.length % AVATAR_COLORS.length],
      createdAt: Date.now(),
      chess: freshPool(),
      checkers: freshPool(),
    };
    await (await db()).put('profiles', profile);
    set({ profiles: [...get().profiles, profile] });
    return profile;
  },

  rename: async (id, name) => {
    const p = get().byId(id);
    if (!p) return;
    const next = { ...p, name };
    await (await db()).put('profiles', next);
    set({ profiles: get().profiles.map((x) => (x.id === id ? next : x)) });
  },

  remove: async (id) => {
    await (await db()).delete('profiles', id);
    set({ profiles: get().profiles.filter((x) => x.id !== id) });
  },

  applyRated: async (id, pool, opponentRating, score) => {
    const p = get().byId(id);
    if (!p) return undefined;
    const old: RatingPool = p[pool];
    const rating = updatedRating(old.rating, opponentRating, score, old.ratedGames);
    const next: Profile = {
      ...p,
      [pool]: {
        ...old,
        rating,
        ratedGames: old.ratedGames + 1,
        wins: old.wins + (score === 1 ? 1 : 0),
        losses: old.losses + (score === 0 ? 1 : 0),
        draws: old.draws + (score === 0.5 ? 1 : 0),
        peak: Math.max(old.peak, rating),
        history: [...old.history, { t: Date.now(), rating }].slice(-500),
        streak:
          score === 1
            ? Math.max(1, old.streak + 1)
            : score === 0
              ? Math.min(-1, old.streak - 1)
              : 0,
      } satisfies RatingPool,
    };
    await (await db()).put('profiles', next);
    set({ profiles: get().profiles.map((x) => (x.id === id ? next : x)) });
    return next;
  },

  byId: (id) => get().profiles.find((p) => p.id === id),
}));
