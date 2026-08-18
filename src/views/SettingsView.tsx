import { useRef, useState } from 'react';
import { useSettings, type BoardTheme, type PieceStyle } from '../state/settingsStore';
import { exportBackup, importBackup, type BackupBlob } from '../lib/db/schema';
import { useProfiles } from '../state/profilesStore';
import { resetAnalysisEngine } from '../state/engineHub';

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

const BOARD_THEMES: Array<{ id: BoardTheme; name: string }> = [
  { id: 'midnight', name: 'Midnight' },
  { id: 'walnut', name: 'Walnut' },
  { id: 'forest', name: 'Forest' },
];

export function SettingsView() {
  const s = useSettings();
  const profiles = useProfiles();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const toggle = (key: keyof typeof s, label: string, hint?: string) => (
    <label className="toggle setting-row" key={key}>
      <div>
        <span>{label}</span>
        {hint && <p className="field-hint">{hint}</p>}
      </div>
      <input
        type="checkbox"
        checked={Boolean(s[key])}
        onChange={(e) => s.update({ [key]: e.target.checked })}
      />
    </label>
  );

  const doExport = async () => {
    const blob = await exportBackup();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(blob, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `gambitlab-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as BackupBlob;
      await importBackup(parsed);
      await profiles.load();
      setImportMsg(`Imported ${parsed.games?.length ?? 0} games, ${parsed.profiles?.length ?? 0} profiles.`);
    } catch (e) {
      setImportMsg(e instanceof Error ? `Import failed: ${e.message}` : 'Import failed');
    }
  };

  return (
    <div className="settings-view">
      <h2>Settings</h2>

      <section>
        <h3>Board</h3>
        <div className="theme-picker">
          {BOARD_THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-swatch ${s.boardTheme === t.id ? 'active' : ''}`}
              data-theme-board={t.id}
              onClick={() => s.update({ boardTheme: t.id })}
            >
              <span className="swatch-squares">
                <i className="sq-light" />
                <i className="sq-dark" />
                <i className="sq-dark" />
                <i className="sq-light" />
              </span>
              {t.name}
            </button>
          ))}
        </div>
        <div className="segment">
          {(['classic', 'minimal'] as PieceStyle[]).map((p) => (
            <button
              key={p}
              className={s.pieceStyle === p ? 'seg-btn active' : 'seg-btn'}
              onClick={() => s.update({ pieceStyle: p })}
            >
              {p} pieces
            </button>
          ))}
        </div>
        {toggle('coordinates', 'Coordinates')}
        {toggle('legalDots', 'Legal move dots')}
        {toggle('premove', 'Premove', 'Queue your reply while the engine thinks')}
        {toggle('autoFlipPvP', 'Flip board each move in pass & play')}
        {toggle('evalBar', 'Eval bar in casual games')}
      </section>

      <section>
        <h3>Feel</h3>
        {toggle('darkMode', 'Dark mode')}
        {toggle('sound', 'Sounds')}
        {toggle('haptics', 'Haptics', 'Vibration on moves (Android)')}
      </section>

      <section>
        <h3>Engine</h3>
        <label className="toggle setting-row">
          <div>
            <span>Multi-threaded analysis engine</span>
            <p className="field-hint">
              Faster analysis on capable browsers (needs cross-origin isolation
              {typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
                ? ' — available here'
                : ' — not available here'}
              ). If threads misbehave the engine falls back automatically.
            </p>
          </div>
          <input
            type="checkbox"
            checked={s.threadedEngine}
            onChange={(e) => {
              s.update({ threadedEngine: e.target.checked });
              resetAnalysisEngine();
            }}
          />
        </label>
      </section>

      <section>
        <h3>Data</h3>
        <div className="data-actions">
          <button className="btn subtle" onClick={() => void doExport()}>
            Export backup (JSON)
          </button>
          <button className="btn subtle" onClick={() => fileRef.current?.click()}>
            Import backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doImport(f);
              e.target.value = '';
            }}
          />
        </div>
        {importMsg && <p className="field-hint">{importMsg}</p>}
      </section>

      <section>
        <h3>About</h3>
        <p className="field-hint">
          GambitLab {__APP_VERSION__} · built {new Date(__BUILD_TIME__).toLocaleString()}
          <br />
          Runs fully offline. Engine: Stockfish 17.1 (NNUE lite) in a Web Worker.
        </p>
      </section>
    </div>
  );
}
