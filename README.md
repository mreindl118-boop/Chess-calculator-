# GambitLab

An offline-capable chess & checkers laboratory: play, analyze, and rate games
against a scalable engine, another human locally, or watch engine-vs-engine —
plus chess variants and a full checkers side game. Ships as an installable PWA
and as an Android app (Capacitor shell) that auto-updates from every web
deploy with no store releases.

## Features

**Chess**
- **Human vs Engine** — Stockfish 17.1 NNUE (lite) in a Web Worker, one
  strength slider mapped to ~250–3200 Elo with named rungs (Beginner 400 →
  Max). Above Stockfish's 1320 floor it's `UCI_LimitStrength`; below, a
  calibrated blend of Skill Level, depth/node caps and MultiPV
  weighted-random move choice keeps 250 genuinely beatable. Hints, takebacks
  (casual), resign/draw offers, premove, optional clock.
- **Engine vs Engine** — independent strength per side, adjustable move
  delay, live eval graph, pause/step/abort.
- **Local PvP** — pass-and-play, optional per-move board flip, rated when
  both sides are bound to profiles.
- **Analysis Lab** — free board editor (palette, side to move,
  castling/en-passant flags), FEN in/out, PGN import/export, infinite
  analysis with eval bar, top-3 lines (MultiPV), depth readout, move tree
  with variations (promote/delete), "play from here" vs the engine.
- **Variants** — Standard (the rated pool), Chess960 with correct 960
  castling (tested), Really Bad Chess (Chaos + Handicap biased by rating
  gap), and custom-FEN starts. All variants playable in all modes; variants
  are tracked as casual records.

**Checkers** — American 8×8 with forced captures, multi-jumps and mid-jump
crowning (toggles: forced-capture off, flying kings). Custom
minimax + alpha-beta + iterative-deepening engine in its own Worker, 5 levels
with fixed published ratings, AI-vs-AI spectate, PvP, and a separate checkers
Elo pool.

**Ratings & scoring** — local profiles with per-profile Chess/Checkers Elo
(K=40 first 30 rated games, then K=20; floor 100; engines have fixed
published ratings). Post-game background analysis produces per-move evals,
accuracy %, ACPL, and Best→Blunder classifications with badges; every
finished game is auto-saved to a searchable library; blunders become
**Blunder Redo** mini-puzzles; a stats dashboard shows rating history, W/L/D,
streaks, accuracy trend and per-variant records. Full JSON backup
export/import.

**Clocks** — presets 1+0, 3+2, 5+0, 10+0, 15+10 plus custom base+increment,
low-time warning, flag = loss with the insufficient-material draw rule
respected.

## Development

```bash
npm install
npm run dev        # copies engine WASM into public/engine, starts Vite
npm test           # Vitest rules/engine/rating suites
npm run lint
npm run build      # production build incl. PWA precache
```

The dev/preview servers send COOP/COEP headers so `crossOriginIsolated` is
true; in production the headers come from `public/_headers` (Cloudflare
Pages). Both Stockfish builds ship: the app defaults to the single-threaded
build everywhere (reliability first — wasm pthread spawning proved unstable
in some Chromium environments, and a spawn-failure storm can wedge the page),
with the **multi-threaded** analysis engine available as a Settings toggle
when isolation is available. If a threaded engine does hit pthread failures
at runtime it detects the failure signature and self-heals onto the
single-threaded build, replaying its options and any interrupted search.

Engine binaries are not committed — `scripts/copy-engine.mjs` copies the
lite NNUE builds out of the `stockfish` npm package before dev/build.

## Architecture

- `src/lib/chess` — `VariantGame` wraps chess.js and owns everything chess.js
  can't do: Chess960 castling (rights tracked per rook file, king-takes-rook
  UCI encoding), Really Bad Chess generation, custom starts, uniform
  repetition tracking and FEN-snapshot undo.
- `src/lib/checkers` — pure rules module (capture DFS with multi-jump,
  crowning, flying kings) + search engine; runs in `src/workers/checkers.worker.ts`.
- `src/lib/engine` — UCI adapter over the Stockfish worker, the Elo
  **calibration module** (`calibration.ts` — the whole ladder in one place),
  `EnginePlayer` (weak-level MultiPV blend), and the game analysis pass.
- `src/state` — Zustand stores; game-state machines live here, components
  contain zero rules logic. `engineHub.ts` owns the (at most two) engine
  workers; all long work is cancelable and off the main thread.
- `src/lib/db` — IndexedDB (idb) schema: profiles, games, puzzles, kv
  (settings + interrupted-game snapshots). Kill the tab mid-game, reopen,
  and the game resumes exactly — clock included.
- Board UI is a custom SVG component (no GPL board libs): pointer-event drag
  with direct DOM transforms during the drag (no per-frame React renders),
  tap-tap input, piece-identity tracking for move animations, premove,
  promotion picker, themes.

## Deploy (Cloudflare Pages)

Push to `main` → GitHub Actions builds, tests and deploys `dist/` via
`wrangler pages deploy` (see `.github/workflows/deploy.yml`; set the
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets and create a Pages
project named `gambitlab`). `public/_headers` sets COOP/COEP so threaded
Stockfish works. The app shows its version (git short SHA) in Settings, and
the service worker surfaces an in-app "Update ready — Restart" toast
(skipWaiting + reload) when a new deploy is live.

## Android (Capacitor)

The `/android` project is a thin shell with `server.url` pointed at the
production domain, so **every web deploy updates the app instantly** — no
store releases. The same service worker provides offline. StatusBar theming,
haptics, and hardware-back-as-in-app-back are wired up.

```bash
npm run android:sync   # build web + cap sync
npm run android:run    # deploy to a connected device/emulator
npm run android:apk    # assembleRelease (see SIGNING.md)
```

Set `GAMBITLAB_URL=https://your-domain` before syncing if your production
domain differs from the default `https://gambitlab.pages.dev`.

> If fully-offline **first launch** on Android ever becomes a requirement,
> the alternative is bundling the web assets in the APK plus Capgo live
> updates — the current server.url mode was chosen deliberately for
> zero-friction updates.

## Known limitations

- Chess960 castling is fully supported in play; in the Analysis Lab, castling
  moves imported from a 960 game replay correctly, but *new* castling moves
  can't be entered mid-variation (rights aren't reconstructible from a bare
  mid-game FEN with `-` castling).
- PGN import reads the mainline (comments/NAGs stripped, variations ignored);
  export writes the analysis mainline.
