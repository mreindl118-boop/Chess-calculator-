import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, validateFen } from 'chess.js';
import { ChessBoard } from '../components/board/ChessBoard';
import { PromotionPicker } from '../components/game/PromotionPicker';
import { EvalBar } from '../components/game/EvalBar';
import { EvalGraph } from '../components/game/EvalGraph';
import { MoveTreeView } from '../components/analysis/MoveTreeView';
import { PieceGlyph } from '../components/board/pieces';
import { analysisTree, useAnalysis } from '../state/analysisStore';
import { useChess } from '../state/chessStore';
import { useNav } from '../state/navStore';
import { useSettings } from '../state/settingsStore';
import { scoreToCp } from '../lib/engine/analysis';
import { explainLine } from '../lib/engine/explain';
import { playSound } from '../lib/audio/sounds';
import { START_FEN, type Color, type PieceSymbol, type Square } from '../lib/chess/types';
import { rungName } from '../lib/engine/calibration';

const EDITOR_PIECES: PieceSymbol[] = ['k', 'q', 'r', 'b', 'n', 'p'];

/**
 * Piece-level legality for the board builder: placements that could never
 * occur in a legal chess position are refused outright. (Whole-position
 * checks — e.g. the side not to move being in check — run again at "Done".)
 */
function placementProblem(
  chess: Chess,
  piece: { type: PieceSymbol; color: Color },
  to: Square,
  /** square being vacated when moving an existing piece, if any */
  from?: Square,
): string | null {
  const rank = to[1];
  if (piece.type === 'p' && (rank === '1' || rank === '8')) {
    return 'Pawns can never stand on the first or last rank';
  }

  const squares: Array<{ sq: Square; type: PieceSymbol; color: Color }> = [];
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      const sq = 'abcdefgh'[f] + String(8 - r);
      if (sq === from || sq === to) continue; // vacated / replaced squares
      squares.push({ sq, type: p.type as PieceSymbol, color: p.color as Color });
    }
  }

  if (piece.type === 'k') {
    if (squares.some((s) => s.type === 'k' && s.color === piece.color)) {
      return 'Each side has exactly one king';
    }
    const enemyKing = squares.find((s) => s.type === 'k' && s.color !== piece.color);
    if (enemyKing && kingsTouch(to, enemyKing.sq)) return 'Kings can never stand next to each other';
  } else {
    // Moving any piece is fine adjacency-wise, but check we don't strand two kings adjacent
    // by capturing the buffer? (not possible — adjacency only involves kings themselves)
    const myKing = squares.find((s) => s.type === 'k' && s.color === piece.color);
    void myKing;
  }

  const mine = squares.filter((s) => s.color === piece.color);
  if (piece.type === 'p' && mine.filter((s) => s.type === 'p').length >= 8) {
    return 'A side can have at most 8 pawns';
  }
  if (mine.length >= 16) return 'A side can have at most 16 pieces';
  return null;
}

function kingsTouch(a: Square, b: Square): boolean {
  return (
    Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) <= 1 &&
    Math.abs(a.charCodeAt(1) - b.charCodeAt(1)) <= 1
  );
}

export function AnalysisView() {
  const a = useAnalysis();
  const chessStore = useChess();
  const nav = useNav();
  const settings = useSettings();
  const [fenInput, setFenInput] = useState('');
  const [showPgn, setShowPgn] = useState(false);
  const [pgnText, setPgnText] = useState('');
  const [palette, setPalette] = useState<{ piece: PieceSymbol; color: Color } | 'erase' | null>(null);
  const [pendingPromo, setPendingPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [showPlayFrom, setShowPlayFrom] = useState(false);
  const [playElo, setPlayElo] = useState(1600);
  const [playColor, setPlayColor] = useState<Color>('w');
  const [orientation, setOrientation] = useState<Color>('w');

  // open a saved game passed via nav params
  const gameId = nav.params.gameId;
  useEffect(() => {
    if (gameId) void useAnalysis.getState().loadSavedGame(gameId);
  }, [gameId]);

  // stop the engine when leaving the view
  useEffect(() => () => a.stopEngine(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const tree = analysisTree();
  const turn = (a.fen.split(' ')[1] ?? 'w') as Color;
  const bestLine = a.lines[0];
  const evalCp = bestLine ? (turn === 'w' ? scoreToCp(bestLine) : -scoreToCp(bestLine)) : null;

  // Best moves at a glance: each engine line explained in plain language.
  const { engineOn, editing, lines, fen: currentFen } = a;
  const explained = useMemo(() => {
    if (!engineOn || editing) return [];
    return lines
      .filter(Boolean)
      .map((line) => ({ line, ex: explainLine(currentFen, line) }))
      .filter(
        (x): x is { line: (typeof lines)[number]; ex: NonNullable<ReturnType<typeof explainLine>> } =>
          !!x.ex,
      );
  }, [engineOn, editing, lines, currentFen]);

  const suggestionArrows = useMemo(
    () =>
      explained.map((x, i) => ({
        from: x.line.pv[0].slice(0, 2),
        to: x.line.pv[0].slice(2, 4),
        rank: i,
      })),
    [explained],
  );

  // ---- editor helpers (operate directly on the FEN) ----
  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const [paletteDrag, setPaletteDrag] = useState<{
    piece: PieceSymbol;
    color: Color;
    x: number;
    y: number;
  } | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const editorErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flagPlacement = (problem: string) => {
    playSound('illegal');
    setEditorError(problem);
    if (editorErrorTimer.current) clearTimeout(editorErrorTimer.current);
    editorErrorTimer.current = setTimeout(() => setEditorError(null), 2600);
  };

  const loadEditorChess = (): Chess => {
    const chess = new Chess();
    chess.clear();
    try {
      chess.load(a.fen, { skipValidation: true } as any);
    } catch {
      chess.clear();
    }
    return chess;
  };

  const editorApply = (fn: (chess: Chess) => void) => {
    const chess = loadEditorChess();
    fn(chess);
    useAnalysis.setState({ fen: chess.fen() });
  };

  /** Rule-checked placement; returns false (with feedback) if it would be illegal. */
  const editorPlace = (
    piece: { type: PieceSymbol; color: Color },
    to: Square,
    from?: Square,
  ): boolean => {
    const problem = placementProblem(loadEditorChess(), piece, to, from);
    if (problem) {
      flagPlacement(problem);
      return false;
    }
    editorApply((chess) => {
      if (from) chess.remove(from as any);
      chess.remove(to as any);
      chess.put(piece as any, to as any);
    });
    return true;
  };

  const editorTap = (sq: Square): boolean => {
    if (!a.editing || palette === null) return false;
    if (palette === 'erase') {
      editorApply((chess) => {
        chess.remove(sq as any);
      });
    } else {
      editorPlace({ type: palette.piece, color: palette.color }, sq);
    }
    return true;
  };

  const editorDrop = (from: Square, to: Square | null) => {
    const chess = loadEditorChess();
    const piece = chess.get(from as any);
    if (!piece) return;
    if (!to) {
      // dragged off the board = remove
      editorApply((c) => {
        c.remove(from as any);
      });
      return;
    }
    editorPlace({ type: piece.type as PieceSymbol, color: piece.color as Color }, to, from);
  };

  /** Drag a fresh piece from the palette straight onto a square. */
  const dragMovedRef = useRef(false);
  const startPaletteDrag = (
    e: React.PointerEvent,
    piece: PieceSymbol,
    color: Color,
  ) => {
    e.preventDefault();
    dragMovedRef.current = false;
    setPaletteDrag({ piece, color, x: e.clientX, y: e.clientY });
    const onMove = (ev: PointerEvent) => {
      dragMovedRef.current = true;
      setPaletteDrag((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY } : d));
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      setPaletteDrag(null);
      const rect = boardWrapRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const fx = Math.floor(((ev.clientX - rect.left) / rect.width) * 8);
      const fy = Math.floor(((ev.clientY - rect.top) / rect.height) * 8);
      if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return;
      const file = orientation === 'w' ? fx : 7 - fx;
      const rank = orientation === 'w' ? 7 - fy : fy;
      const sq = 'abcdefgh'[file] + String(rank + 1);
      editorPlace({ type: piece, color }, sq);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  const editorSetField = (idx: number, value: string) => {
    const parts = a.fen.split(' ');
    parts[idx] = value;
    if (idx === 1) parts[3] = '-'; // switching side clears ep
    useAnalysis.setState({ fen: parts.join(' ') });
  };

  const editorCastlingToggle = (flag: string) => {
    const parts = a.fen.split(' ');
    const cur = parts[2] === '-' ? '' : parts[2];
    const next = cur.includes(flag) ? cur.replace(flag, '') : sortCastling(cur + flag);
    parts[2] = next === '' ? '-' : next;
    useAnalysis.setState({ fen: parts.join(' ') });
  };

  const editorValidation = useMemo(() => {
    if (!a.editing) return null;
    const v = validateFen(a.fen);
    return v.ok ? null : (v.error ?? 'invalid position');
  }, [a.editing, a.fen]);

  const finishEditing = () => {
    if (editorValidation) return;
    const fen = a.fen;
    // A position is illegal if the side NOT to move is standing in check
    // (their king could be captured immediately).
    const parts = fen.split(' ');
    const flipped = [...parts];
    flipped[1] = parts[1] === 'w' ? 'b' : 'w';
    flipped[3] = '-';
    try {
      if (new Chess(flipped.join(' ')).isCheck()) {
        flagPlacement(
          `${parts[1] === 'w' ? 'Black' : 'White'} is in check but it isn't their turn — adjust the position or the side to move`,
        );
        return;
      }
    } catch {
      /* flipped FEN unloadable — the normal validation already covers it */
    }
    a.setEditing(false);
    a.setRoot(fen, fen === START_FEN ? 'standard' : 'custom');
    // Best moves should appear at a glance the moment the position is built.
    if (!useAnalysis.getState().engineOn) a.toggleEngine();
  };

  const attemptMove = (from: Square, to: Square) => {
    if (a.editing) return;
    if (a.needsPromotion(from, to)) {
      setPendingPromo({ from, to });
      return;
    }
    a.tryMove(from, to);
  };

  const playFromHere = () => {
    chessStore.newGame({
      mode: 'hve',
      variant: 'custom',
      customFen: a.fen,
      humanColor: playColor,
      engineElo: playElo,
      timeControl: null,
      rated: false,
      white:
        playColor === 'w'
          ? { kind: 'guest', name: 'You' }
          : { kind: 'engine', elo: playElo, name: `Engine ${rungName(playElo)}` },
      black:
        playColor === 'b'
          ? { kind: 'guest', name: 'You' }
          : { kind: 'engine', elo: playElo, name: `Engine ${rungName(playElo)}` },
    });
    nav.go('play');
  };

  const evalSeries = useMemo(() => {
    if (!a.loadedGameAnalysis) return null;
    return a.loadedGameAnalysis.evals;
  }, [a.loadedGameAnalysis]);

  const currentPath = tree.pathTo(a.currentNodeId);

  return (
    <div className="analysis-view">
      {paletteDrag && (
        <div className="drag-ghost" style={{ left: paletteDrag.x, top: paletteDrag.y }}>
          <svg viewBox="0 0 100 100">
            <PieceGlyph
              type={paletteDrag.piece}
              color={paletteDrag.color}
              style={settings.pieceStyle}
            />
          </svg>
        </div>
      )}
      <div className="play-header">
        <button className="btn subtle" onClick={() => nav.go('home')}>
          ‹ Home
        </button>
        <span className="game-tag">Analysis Lab</span>
        <button className="btn subtle" onClick={() => setOrientation(orientation === 'w' ? 'b' : 'w')}>
          ⇅ Flip
        </button>
      </div>

      <div className="board-row">
        {!a.editing && a.engineOn && <EvalBar cp={evalCp} orientation={orientation} />}
        <div className="board-wrap" data-theme-board={settings.boardTheme} ref={boardWrapRef}>
          <ChessBoard
            fen={a.fen}
            orientation={orientation}
            interactive
            movableColor="both"
            lastMove={
              currentPath.length > 0
                ? {
                    from: currentPath[currentPath.length - 1].move!.from,
                    to: currentPath[currentPath.length - 1].move!.to,
                  }
                : null
            }
            arrows={suggestionArrows}
            legalTargetsFor={(sq) => (a.editing ? [] : a.legalTargets(sq))}
            onMove={({ from, to }) => attemptMove(from, to)}
            onEditorDrop={a.editing ? editorDrop : undefined}
            onSquareTap={a.editing ? editorTap : undefined}
          />
          {pendingPromo && (
            <PromotionPicker
              color={turn}
              onPick={(p) => {
                a.tryMove(pendingPromo.from, pendingPromo.to, p);
                setPendingPromo(null);
              }}
              onCancel={() => setPendingPromo(null)}
            />
          )}
        </div>
      </div>

      {a.editing ? (
        <div className="editor-panel">
          <p className="field-hint">
            Drag a piece from the tray onto the board (or tap it, then tap squares). Drag pieces
            off the board to remove them. Only legal placements are accepted.
          </p>
          {editorError && <p className="field-error placement-error">{editorError}</p>}
          <div className="palette">
            {(['w', 'b'] as const).map((c) => (
              <div key={c} className="palette-row">
                {EDITOR_PIECES.map((p) => {
                  const active =
                    palette !== null && palette !== 'erase' && palette.piece === p && palette.color === c;
                  return (
                    <button
                      key={p}
                      className={`palette-piece ${active ? 'active' : ''}`}
                      onPointerDown={(e) => startPaletteDrag(e, p, c)}
                      onClick={() => {
                        if (dragMovedRef.current) {
                          dragMovedRef.current = false;
                          return; // this click was the tail end of a drag
                        }
                        setPalette(active ? null : { piece: p, color: c });
                      }}
                    >
                      <svg viewBox="0 0 100 100">
                        <PieceGlyph type={p} color={c} style={settings.pieceStyle} />
                      </svg>
                    </button>
                  );
                })}
                {c === 'b' && (
                  <button
                    className={`palette-piece ${palette === 'erase' ? 'active' : ''}`}
                    onClick={() => setPalette(palette === 'erase' ? null : 'erase')}
                    title="Erase"
                  >
                    ⌫
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="editor-fields">
            <label>
              Side to move
              <select value={a.fen.split(' ')[1]} onChange={(e) => editorSetField(1, e.target.value)}>
                <option value="w">White</option>
                <option value="b">Black</option>
              </select>
            </label>
            <div className="castling-flags">
              {['K', 'Q', 'k', 'q'].map((f) => (
                <label key={f} className="toggle small">
                  <input
                    type="checkbox"
                    checked={(a.fen.split(' ')[2] ?? '-').includes(f)}
                    onChange={() => editorCastlingToggle(f)}
                  />
                  <span>{f}</span>
                </label>
              ))}
            </div>
            <label>
              En passant
              <input
                value={a.fen.split(' ')[3] ?? '-'}
                onChange={(e) => editorSetField(3, e.target.value || '-')}
                size={3}
              />
            </label>
          </div>
          <div className="editor-actions">
            <button
              className="btn subtle"
              onClick={() => useAnalysis.setState({ fen: START_FEN })}
            >
              Start pos
            </button>
            <button
              className="btn subtle"
              onClick={() => useAnalysis.setState({ fen: '8/8/8/8/8/8/8/8 w - - 0 1' })}
            >
              Clear
            </button>
            <button className="btn primary" disabled={!!editorValidation} onClick={finishEditing}>
              Done
            </button>
          </div>
          {editorValidation && <p className="field-error">{editorValidation}</p>}
        </div>
      ) : (
        <>
          <div className="engine-panel">
            <div className="engine-head">
              <button
                className={`btn ${a.engineOn ? 'primary' : ''}`}
                onClick={a.toggleEngine}
              >
                {a.engineOn ? '■ Engine on' : '▶ Engine'}
              </button>
              {a.engineOn && <span className="depth-readout">depth {a.depth}</span>}
              <div className="spacer" />
              <button className="btn subtle" onClick={a.back}>
                ◀
              </button>
              <button className="btn subtle" onClick={a.forward}>
                ▶
              </button>
            </div>
            {a.engineOn && explained.length === 0 && (
              <p className="field-hint">Thinking…</p>
            )}
            {a.engineOn &&
              explained.map(({ line, ex }, i) => {
                const white = ex.evalWhiteCp;
                const label =
                  line.scoreMate !== undefined
                    ? `#${Math.abs(line.scoreMate)}`
                    : (white / 100).toFixed(2);
                return (
                  <button
                    key={line.multipv}
                    className={`engine-line rank-${Math.min(2, i)}`}
                    onClick={() => {
                      const uci = line.pv[0];
                      if (uci) attemptMove(uci.slice(0, 2), uci.slice(2, 4));
                    }}
                  >
                    <div className="line-top">
                      <span className={`line-rank r${Math.min(2, i)}`}>{i + 1}</span>
                      <span className="line-san">{ex.san}</span>
                      <span className={`line-eval ${white >= 0 ? 'pos' : 'neg'}`}>
                        {white >= 0 && line.scoreMate === undefined ? '+' : ''}
                        {label}
                      </span>
                    </div>
                    <p className="line-explain">{ex.text}</p>
                    <span className="line-pv">{ex.continuation}</span>
                  </button>
                );
              })}
          </div>

          <MoveTreeView
            tree={tree}
            currentNodeId={a.currentNodeId}
            onSelect={a.goto}
            onPromote={a.promoteVariation}
            onDelete={a.deleteVariation}
          />

          {a.loadedGameAnalysis && (
            <div className="accuracy-strip">
              <span>
                White <strong>{a.loadedGameAnalysis.accuracy.w}%</strong> ·{' '}
                {a.loadedGameAnalysis.acpl.w} avg loss
              </span>
              <span>
                Black <strong>{a.loadedGameAnalysis.accuracy.b}%</strong> ·{' '}
                {a.loadedGameAnalysis.acpl.b} avg loss
              </span>
            </div>
          )}

          {evalSeries && evalSeries.length > 1 && (
            <EvalGraph
              evals={evalSeries}
              currentPly={currentPath.length}
              onSeek={(ply) => {
                const main = tree.mainline();
                if (ply === 0) a.goto(tree.rootId);
                else if (main[ply - 1]) a.goto(main[ply - 1].id);
              }}
            />
          )}

          <div className="analysis-toolbar">
            <button className="btn subtle" onClick={() => a.setEditing(true)}>
              ✎ Build position
            </button>
            <button className="btn subtle" onClick={() => setShowPlayFrom(!showPlayFrom)}>
              Play from here
            </button>
            <button className="btn subtle" onClick={() => setShowPgn(!showPgn)}>
              PGN
            </button>
            <button
              className="btn subtle"
              onClick={() => {
                void navigator.clipboard?.writeText(a.fen).catch(() => {});
              }}
            >
              Copy FEN
            </button>
          </div>

          {showPlayFrom && (
            <div className="playfrom-panel">
              <label>
                Engine Elo
                <input
                  type="number"
                  min={250}
                  max={3200}
                  value={playElo}
                  onChange={(e) => setPlayElo(parseInt(e.target.value || '1600', 10))}
                />
              </label>
              <label>
                You play
                <select value={playColor} onChange={(e) => setPlayColor(e.target.value as Color)}>
                  <option value="w">White</option>
                  <option value="b">Black</option>
                </select>
              </label>
              <button className="btn primary" onClick={playFromHere}>
                Start
              </button>
            </div>
          )}

          <div className="fen-row">
            <input
              value={fenInput}
              onChange={(e) => setFenInput(e.target.value)}
              placeholder={a.fen}
              spellCheck={false}
            />
            <button
              className="btn subtle"
              onClick={() => {
                const fen = fenInput.trim();
                if (!fen) return;
                const v = validateFen(fen);
                if (v.ok) {
                  a.setRoot(fen, fen === START_FEN ? 'standard' : 'custom');
                  setFenInput('');
                }
              }}
            >
              Load FEN
            </button>
          </div>

          {showPgn && (
            <div className="pgn-panel">
              <textarea
                rows={6}
                value={pgnText}
                onChange={(e) => setPgnText(e.target.value)}
                placeholder="Paste PGN here to import…"
                spellCheck={false}
              />
              <div className="pgn-actions">
                <button
                  className="btn subtle"
                  onClick={() => {
                    if (pgnText.trim()) a.loadPgnText(pgnText);
                  }}
                >
                  Import
                </button>
                <button className="btn subtle" onClick={() => setPgnText(a.exportPgnText())}>
                  Export
                </button>
                <button
                  className="btn subtle"
                  onClick={() => void navigator.clipboard?.writeText(a.exportPgnText()).catch(() => {})}
                >
                  Copy
                </button>
              </div>
              {a.error && <p className="field-error">{a.error}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function sortCastling(flags: string): string {
  const order = 'KQkq';
  return [...new Set(flags.split(''))]
    .sort((x, y) => order.indexOf(x) - order.indexOf(y))
    .join('');
}
