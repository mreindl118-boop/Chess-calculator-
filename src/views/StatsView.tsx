import { useEffect, useMemo, useState } from 'react';
import { useProfiles } from '../state/profilesStore';
import { db, type SavedGame, type RatingPool } from '../lib/db/schema';

function RatingChart({ history, baseline }: { history: Array<{ t: number; rating: number }>; baseline: number }) {
  if (history.length < 2) {
    return <p className="field-hint">Play rated games to build a rating history.</p>;
  }
  const ratings = history.map((h) => h.rating);
  const min = Math.min(...ratings, baseline) - 30;
  const max = Math.max(...ratings, baseline) + 30;
  const pts = history
    .map((h, i) => {
      const x = (i / (history.length - 1)) * 100;
      const y = 100 - ((h.rating - min) / (max - min)) * 100;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' L');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="rating-chart">
      <path d={`M${pts}`} fill="none" className="rating-line" />
    </svg>
  );
}

function PoolStats({ pool, label }: { pool: RatingPool; label: string }) {
  return (
    <div className="pool-stats">
      <div className="pool-head">
        <h4>{label}</h4>
        <span className="pool-rating">{pool.rating}</span>
        <span className="pool-peak">peak {pool.peak}</span>
      </div>
      <RatingChart history={pool.history} baseline={1200} />
      <div className="pool-numbers">
        <span>{pool.wins}W</span>
        <span>{pool.draws}D</span>
        <span>{pool.losses}L</span>
        <span>
          {pool.streak > 0
            ? `${pool.streak}🔥`
            : pool.streak < 0
              ? `${-pool.streak} losses`
              : '—'}
        </span>
        <span>{pool.ratedGames} rated</span>
      </div>
    </div>
  );
}

export function StatsView() {
  const profiles = useProfiles();
  const [selected, setSelected] = useState<string>('');
  const [games, setGames] = useState<SavedGame[]>([]);

  useEffect(() => {
    if (!selected && profiles.profiles.length > 0) setSelected(profiles.profiles[0].id);
  }, [profiles.profiles, selected]);

  useEffect(() => {
    void (async () => {
      const all = await (await db()).getAll('games');
      setGames(all);
    })();
  }, []);

  const profile = profiles.byId(selected);

  const derived = useMemo(() => {
    if (!profile) return null;
    const mine = games.filter(
      (g) =>
        (g.white.kind === 'profile' && g.white.profileId === profile.id) ||
        (g.black.kind === 'profile' && g.black.profileId === profile.id),
    );
    const accuracies: number[] = [];
    const perVariant = new Map<string, { w: number; l: number; d: number }>();
    for (const g of mine) {
      const side = g.white.kind === 'profile' && g.white.profileId === profile.id ? 'w' : 'b';
      if (g.accuracySummary) accuracies.push(g.accuracySummary[side]);
      const v = perVariant.get(g.variant) ?? { w: 0, l: 0, d: 0 };
      if (g.result === '1/2-1/2') v.d++;
      else if ((g.result === '1-0') === (side === 'w')) v.w++;
      else v.l++;
      perVariant.set(g.variant, v);
    }
    return {
      total: mine.length,
      accuracyTrend: accuracies.slice(-20),
      avgAccuracy:
        accuracies.length > 0
          ? Math.round((accuracies.reduce((a, b) => a + b, 0) / accuracies.length) * 10) / 10
          : null,
      perVariant: [...perVariant.entries()],
    };
  }, [games, profile]);

  if (profiles.profiles.length === 0) {
    return (
      <div className="stats-view">
        <h2>Stats</h2>
        <p className="field-hint">Create a profile on the home screen to start tracking stats.</p>
      </div>
    );
  }

  return (
    <div className="stats-view">
      <h2>Stats</h2>
      <div className="segment">
        {profiles.profiles.map((p) => (
          <button
            key={p.id}
            className={selected === p.id ? 'seg-btn active' : 'seg-btn'}
            onClick={() => setSelected(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {profile && (
        <>
          <PoolStats pool={profile.chess} label="Chess (standard)" />
          <PoolStats pool={profile.checkers} label="Checkers" />

          {derived && (
            <div className="derived-stats">
              <h4>Across {derived.total} games</h4>
              {derived.avgAccuracy !== null && (
                <p>
                  Average accuracy <strong>{derived.avgAccuracy}%</strong>
                </p>
              )}
              {derived.accuracyTrend.length > 1 && (
                <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="accuracy-trend">
                  <path
                    d={`M${derived.accuracyTrend
                      .map(
                        (a, i) =>
                          `${(i / (derived.accuracyTrend.length - 1)) * 100},${40 - (a / 100) * 40}`,
                      )
                      .join(' L')}`}
                    fill="none"
                    className="rating-line"
                  />
                </svg>
              )}
              <div className="variant-records">
                {derived.perVariant.map(([variant, r]) => (
                  <div key={variant} className="variant-record">
                    <span>{variant}</span>
                    <span>
                      {r.w}W {r.d}D {r.l}L
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
