import { useMemo, useState } from 'react';
import type { ChessGameConfig } from '../../state/chessStore';
import type { CheckersGameConfig } from '../../state/checkersStore';
import type { ChessVariant, Color } from '../../lib/chess/types';
import { CLOCK_PRESETS, type TimeControl } from '../../lib/clock/clock';
import { ENGINE_RUNGS, MAX_ELO, MIN_ELO, rungName } from '../../lib/engine/calibration';
import { CHECKERS_LEVELS } from '../../lib/checkers/engine';
import { useProfiles } from '../../state/profilesStore';
import type { PlayerRef } from '../../lib/db/schema';
import { validateFen } from 'chess.js';

export type NewGameRequest =
  | { game: 'chess'; config: ChessGameConfig }
  | { game: 'checkers'; config: CheckersGameConfig };

const VARIANTS: Array<{ id: ChessVariant; name: string; desc: string }> = [
  { id: 'standard', name: 'Standard', desc: 'Classical chess — the only rated variant' },
  { id: 'chess960', name: 'Chess960', desc: 'Shuffled back rank, 960 castling rules' },
  { id: 'rbc-chaos', name: 'Really Bad Chess — Chaos', desc: 'Fully random armies, both sides' },
  {
    id: 'rbc-handicap',
    name: 'Really Bad Chess — Handicap',
    desc: 'Stronger random army for the lower-rated side',
  },
  { id: 'custom', name: 'Custom start', desc: 'Any legal FEN as the starting position' },
];

function Segment<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: Array<{ v: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segment">
      {options.map((o) => (
        <button
          key={String(o.v)}
          className={o.v === value ? 'seg-btn active' : 'seg-btn'}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function NewGameSheet({
  onStart,
  onClose,
}: {
  onStart: (req: NewGameRequest) => void;
  onClose: () => void;
}) {
  const profiles = useProfiles((s) => s.profiles);
  const [game, setGame] = useState<'chess' | 'checkers'>('chess');
  const [chessMode, setChessMode] = useState<'hve' | 'eve' | 'pvp'>('hve');
  const [checkersMode, setCheckersMode] = useState<'hva' | 'ava' | 'pvp'>('hva');
  const [variant, setVariant] = useState<ChessVariant>('standard');
  const [customFen, setCustomFen] = useState('');
  const [color, setColor] = useState<'w' | 'b' | 'random'>('random');
  const [elo, setElo] = useState(1200);
  const [eloW, setEloW] = useState(1600);
  const [eloB, setEloB] = useState(1600);
  const [aiLevel, setAiLevel] = useState(3);
  const [aiLevelW, setAiLevelW] = useState(3);
  const [aiLevelB, setAiLevelB] = useState(3);
  const [clockChoice, setClockChoice] = useState<string>('none');
  const [customBase, setCustomBase] = useState(10);
  const [customInc, setCustomInc] = useState(5);
  const [rated, setRated] = useState(false);
  const [profileA, setProfileA] = useState<string>('');
  const [profileB, setProfileB] = useState<string>('');
  const [forcedCapture, setForcedCapture] = useState(true);
  const [flyingKings, setFlyingKings] = useState(false);

  const isPvP = game === 'chess' ? chessMode === 'pvp' : checkersMode === 'pvp';
  const isHvAi = game === 'chess' ? chessMode === 'hve' : checkersMode === 'hva';
  const ratedAllowed =
    (game === 'chess' ? variant === 'standard' && chessMode !== 'eve' : checkersMode !== 'ava') &&
    !!profileA &&
    (isPvP ? !!profileB && profileA !== profileB : true);

  const fenError = useMemo(() => {
    if (game !== 'chess' || variant !== 'custom' || !customFen.trim()) return null;
    const v = validateFen(customFen.trim());
    return v.ok ? null : (v.error ?? 'invalid FEN');
  }, [game, variant, customFen]);

  const timeControl: TimeControl | null = useMemo(() => {
    if (clockChoice === 'none') return null;
    if (clockChoice === 'custom')
      return { base: Math.max(0.25, customBase) * 60, inc: Math.max(0, customInc) };
    const preset = CLOCK_PRESETS.find((p) => p.name === clockChoice);
    return preset ? preset.tc : null;
  }, [clockChoice, customBase, customInc]);

  function profileRef(id: string, fallback: string): PlayerRef {
    const p = profiles.find((x) => x.id === id);
    return p
      ? { kind: 'profile', profileId: p.id, name: p.name }
      : { kind: 'guest', name: fallback };
  }

  function start() {
    if (game === 'chess') {
      const humanColor: Color =
        color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
      const engineRef = (e: number): PlayerRef => ({
        kind: 'engine',
        elo: e,
        name: `Engine ${rungName(e)}`,
      });
      let white: PlayerRef;
      let black: PlayerRef;
      if (chessMode === 'hve') {
        const me = profileRef(profileA, 'You');
        white = humanColor === 'w' ? me : engineRef(elo);
        black = humanColor === 'b' ? me : engineRef(elo);
      } else if (chessMode === 'eve') {
        white = engineRef(eloW);
        black = engineRef(eloB);
      } else {
        white = profileRef(profileA, 'White');
        black = profileRef(profileB, 'Black');
      }
      const gapFor = () => {
        // handicap bias from the rating gap between bound profiles/engine
        const wr = white.kind === 'profile'
          ? useProfiles.getState().byId(white.profileId)?.chess.rating
          : white.kind === 'engine' ? white.elo : undefined;
        const br = black.kind === 'profile'
          ? useProfiles.getState().byId(black.profileId)?.chess.rating
          : black.kind === 'engine' ? black.elo : undefined;
        return wr !== undefined && br !== undefined ? wr - br : 0;
      };
      const config: ChessGameConfig = {
        mode: chessMode,
        variant,
        customFen: variant === 'custom' ? customFen.trim() : undefined,
        rbcRatingGap: variant === 'rbc-handicap' ? gapFor() : undefined,
        humanColor: chessMode === 'hve' ? humanColor : undefined,
        engineElo: chessMode === 'hve' ? elo : undefined,
        eveElo: chessMode === 'eve' ? { w: eloW, b: eloB } : undefined,
        eveDelayMs: 700,
        timeControl,
        rated: rated && ratedAllowed,
        white,
        black,
      };
      onStart({ game: 'chess', config });
    } else {
      const humanColor = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
      const aiRef = (lvl: number): PlayerRef => {
        const L = CHECKERS_LEVELS[lvl - 1];
        return { kind: 'checkers-ai', level: lvl, rating: L.rating, name: `AI ${L.name}` };
      };
      let white: PlayerRef;
      let black: PlayerRef;
      if (checkersMode === 'hva') {
        const me = profileRef(profileA, 'You');
        white = humanColor === 'w' ? me : aiRef(aiLevel);
        black = humanColor === 'b' ? me : aiRef(aiLevel);
      } else if (checkersMode === 'ava') {
        white = aiRef(aiLevelW);
        black = aiRef(aiLevelB);
      } else {
        white = profileRef(profileA, 'White');
        black = profileRef(profileB, 'Black');
      }
      const config: CheckersGameConfig = {
        mode: checkersMode,
        rules: { forcedCapture, flyingKings },
        humanColor: checkersMode === 'hva' ? humanColor : undefined,
        aiLevel: checkersMode === 'hva' ? aiLevel : undefined,
        avaLevels: checkersMode === 'ava' ? { w: aiLevelW, b: aiLevelB } : undefined,
        avaDelayMs: 700,
        timeControl,
        rated: rated && ratedAllowed,
        white,
        black,
      };
      onStart({ game: 'checkers', config });
    }
  }

  const eloSlider = (value: number, onChange: (v: number) => void) => (
    <div className="elo-slider">
      <input
        type="range"
        min={MIN_ELO}
        max={MAX_ELO}
        step={10}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
      />
      <div className="elo-readout">
        <strong>{value}</strong> <span>{rungName(value)}</span>
      </div>
      <div className="elo-rungs">
        {ENGINE_RUNGS.map((r) => (
          <button key={r.name} className="rung" onClick={() => onChange(r.elo)}>
            {r.name}
          </button>
        ))}
      </div>
    </div>
  );

  const profilePicker = (value: string, onChange: (v: string) => void, label: string) => (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Guest (unrated)</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <h2>New game</h2>

        <Segment
          options={[
            { v: 'chess' as const, label: '♞ Chess' },
            { v: 'checkers' as const, label: '⛀ Checkers' },
          ]}
          value={game}
          onChange={setGame}
        />

        {game === 'chess' ? (
          <Segment
            options={[
              { v: 'hve' as const, label: 'vs Engine' },
              { v: 'pvp' as const, label: 'Pass & play' },
              { v: 'eve' as const, label: 'Engine vs Engine' },
            ]}
            value={chessMode}
            onChange={setChessMode}
          />
        ) : (
          <Segment
            options={[
              { v: 'hva' as const, label: 'vs AI' },
              { v: 'pvp' as const, label: 'Pass & play' },
              { v: 'ava' as const, label: 'AI vs AI' },
            ]}
            value={checkersMode}
            onChange={setCheckersMode}
          />
        )}

        {game === 'chess' && (
          <>
            <label className="field">
              <span>Variant</span>
              <select
                value={variant}
                onChange={(e) => setVariant(e.target.value as ChessVariant)}
              >
                {VARIANTS.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="field-hint">{VARIANTS.find((v) => v.id === variant)?.desc}</p>
            {variant === 'custom' && (
              <label className="field">
                <span>Start FEN</span>
                <input
                  value={customFen}
                  onChange={(e) => setCustomFen(e.target.value)}
                  placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
                  spellCheck={false}
                />
                {fenError && <span className="field-error">{fenError}</span>}
              </label>
            )}
          </>
        )}

        {game === 'checkers' && (
          <div className="toggles">
            <label className="toggle">
              <input
                type="checkbox"
                checked={forcedCapture}
                onChange={(e) => setForcedCapture(e.target.checked)}
              />
              <span>Forced captures</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={flyingKings}
                onChange={(e) => setFlyingKings(e.target.checked)}
              />
              <span>Flying kings</span>
            </label>
          </div>
        )}

        {isHvAi && (
          <>
            <label className="field">
              <span>Your color</span>
              <Segment
                options={[
                  { v: 'w' as const, label: 'White' },
                  { v: 'random' as const, label: 'Random' },
                  { v: 'b' as const, label: 'Black' },
                ]}
                value={color}
                onChange={setColor}
              />
            </label>
            {game === 'chess' ? (
              <label className="field">
                <span>Engine strength</span>
                {eloSlider(elo, setElo)}
              </label>
            ) : (
              <label className="field">
                <span>AI level</span>
                <Segment
                  options={CHECKERS_LEVELS.map((l) => ({ v: l.level, label: `${l.level}` }))}
                  value={aiLevel}
                  onChange={(v) => setAiLevel(v)}
                />
                <p className="field-hint">
                  {CHECKERS_LEVELS[aiLevel - 1].name} · rated {CHECKERS_LEVELS[aiLevel - 1].rating}
                </p>
              </label>
            )}
            {profilePicker(profileA, setProfileA, 'Play as')}
          </>
        )}

        {game === 'chess' && chessMode === 'eve' && (
          <>
            <label className="field">
              <span>White engine</span>
              {eloSlider(eloW, setEloW)}
            </label>
            <label className="field">
              <span>Black engine</span>
              {eloSlider(eloB, setEloB)}
            </label>
          </>
        )}
        {game === 'checkers' && checkersMode === 'ava' && (
          <>
            <label className="field">
              <span>White AI level</span>
              <Segment
                options={CHECKERS_LEVELS.map((l) => ({ v: l.level, label: `${l.level}` }))}
                value={aiLevelW}
                onChange={setAiLevelW}
              />
            </label>
            <label className="field">
              <span>Black AI level</span>
              <Segment
                options={CHECKERS_LEVELS.map((l) => ({ v: l.level, label: `${l.level}` }))}
                value={aiLevelB}
                onChange={setAiLevelB}
              />
            </label>
          </>
        )}

        {isPvP && (
          <>
            {profilePicker(profileA, setProfileA, 'White player')}
            {profilePicker(profileB, setProfileB, 'Black player')}
          </>
        )}

        <label className="field">
          <span>Clock</span>
          <div className="clock-presets">
            <button
              className={clockChoice === 'none' ? 'chip active' : 'chip'}
              onClick={() => setClockChoice('none')}
            >
              None
            </button>
            {CLOCK_PRESETS.map((p) => (
              <button
                key={p.name}
                className={clockChoice === p.name ? 'chip active' : 'chip'}
                onClick={() => setClockChoice(p.name)}
              >
                {p.name}
              </button>
            ))}
            <button
              className={clockChoice === 'custom' ? 'chip active' : 'chip'}
              onClick={() => setClockChoice('custom')}
            >
              Custom
            </button>
          </div>
          {clockChoice === 'custom' && (
            <div className="custom-clock">
              <input
                type="number"
                min={1}
                max={180}
                value={customBase}
                onChange={(e) => setCustomBase(parseInt(e.target.value || '10', 10))}
              />
              <span>min +</span>
              <input
                type="number"
                min={0}
                max={60}
                value={customInc}
                onChange={(e) => setCustomInc(parseInt(e.target.value || '0', 10))}
              />
              <span>sec</span>
            </div>
          )}
        </label>

        <label className={`toggle rated-toggle ${ratedAllowed ? '' : 'disabled'}`}>
          <input
            type="checkbox"
            checked={rated && ratedAllowed}
            disabled={!ratedAllowed}
            onChange={(e) => setRated(e.target.checked)}
          />
          <span>
            Rated
            {!ratedAllowed && (
              <em className="field-hint">
                {game === 'chess' && variant !== 'standard'
                  ? ' — variants are casual'
                  : ' — bind profile(s) to rate this game'}
              </em>
            )}
          </span>
        </label>

        <div className="sheet-actions">
          <button
            className="btn primary big"
            disabled={game === 'chess' && variant === 'custom' && (!customFen.trim() || !!fenError)}
            onClick={start}
          >
            Start game
          </button>
          <button className="btn subtle" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
