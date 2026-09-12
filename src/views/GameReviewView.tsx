import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChessBoard } from '../components/board/ChessBoard';
import { CoachAvatar } from '../components/coach/CoachAvatar';
import { useReview, fenAtPly } from '../state/reviewStore';
import { useSettings } from '../state/settingsStore';
import { MATE_SCORE } from '../lib/engine/analysis';
import {
  REVIEW_META,
  REVIEW_ORDER,
  expressionFor,
  finalVerdict,
  moodAt,
  moodBucket,
  restingExpression,
  MOOD_START,
  type Expression,
  type ReviewClass,
} from '../lib/engine/review';
import type { Color, Square } from '../lib/chess/types';

const SAMPLE_PGN = `[Event "Immortal Game"]
[White "Anderssen"]
[Black "Kieseritzky"]

1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6 6. Nf3 Qh6 7. d3 Nh5
8. Nh4 Qg5 9. Nf5 c6 10. g4 Nf6 11. Rg1 cxb5 12. h4 Qg6 13. h5 Qg5 14. Qf3 Ng8
15. Bxf4 Qf6 16. Nc3 Bc5 17. Nd5 Qxb2 18. Bd6 Bxg1 19. e5 Qxa1+ 20. Ke2 Na6
21. Nxg7+ Kd8 22. Qf6+ Nxf6 23. Be7# 1-0`;

function fmtEval(cp: number): string {
  if (Math.abs(cp) > MATE_SCORE - 200) {
    const n = MATE_SCORE - Math.abs(cp);
    return `${cp > 0 ? '' : '-'}M${Math.max(1, n)}`;
  }
  const v = cp / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}

const uciSquares = (uci: string): { from: Square; to: Square } | null =>
  uci && uci.length >= 4 ? { from: uci.slice(0, 2), to: uci.slice(2, 4) } : null;

function speak(text: string, onDone?: () => void): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onDone?.();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.02;
  u.pitch = 1.25;
  const voices = synth.getVoices();
  const pref =
    voices.find((v) =>
      /female|zira|samantha|victoria|karen|tessa|fiona|google uk english female/i.test(v.name),
    ) || voices.find((v) => /^en/i.test(v.lang));
  if (pref) u.voice = pref;
  u.onend = () => onDone?.();
  synth.speak(u);
}

export function GameReviewView() {
  const r = useReview();
  const settings = useSettings();
  const [dragOver, setDragOver] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const { game, review, viewPly, running, progress } = r;
  const n = game?.moves.length ?? 0;
  const fen = useMemo(() => fenAtPly(game, viewPly), [game, viewPly]);

  const orientation: Color = settings.autoFlip ? ((fen.split(' ')[1] as Color) ?? 'w') : 'w';

  const curMove = viewPly >= 1 && review ? review.moves[viewPly - 1] : null;
  const mood = review ? moodAt(review.moodSeries, viewPly) : MOOD_START;

  const expression: Expression = curMove
    ? expressionFor(curMove.reviewClass)
    : restingExpression(mood);

  const bubble: string = curMove
    ? curMove.line
    : review
      ? `All right — ${n} moves on the board. Step through, or jump straight to the juicy bits.`
      : "Paste a game and let's see what you've got. Impress me.";

  // Board decorations for the current move.
  const lastMove = curMove ? { from: curMove.from as Square, to: curMove.to as Square } : null;
  const isBrilliant = curMove?.reviewClass === 'brilliant';
  const sacArrow = isBrilliant ? uciSquares(curMove!.uci) : null;
  const showBest =
    curMove &&
    !isBrilliant &&
    curMove.bestUci &&
    curMove.bestUci !== curMove.uci &&
    (curMove.reviewClass === 'inaccuracy' ||
      curMove.reviewClass === 'miss' ||
      curMove.reviewClass === 'mistake' ||
      curMove.reviewClass === 'blunder');
  const bestArrow = showBest ? uciSquares(curMove!.bestUci) : null;

  const verdict = review ? finalVerdict(review.finalMood, (review.accuracy.w + review.accuracy.b) / 2, review.counts) : null;

  // Auto-narrate move reactions when the coach voice is on.
  useEffect(() => {
    if (!settings.coachVoice || !curMove) return;
    setSpeaking(true);
    speak(bubble, () => setSpeaking(false));
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
      setSpeaking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPly, review, settings.coachVoice]);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      const f = files?.[0];
      if (!f) return;
      const text = await f.text();
      r.setPgn(text);
      void r.run(text);
    },
    [r],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
      else {
        const text = e.dataTransfer.getData('text');
        if (text.trim()) {
          r.setPgn(text);
          void r.run(text);
        }
      }
    },
    [handleFiles, r],
  );

  const speakVerdict = () => {
    if (!verdict) return;
    setSpeaking(true);
    speak(verdict.line, () => setSpeaking(false));
  };

  return (
    <div
      className="review-view"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="review-head">
        <h2>Game Review</h2>
        <p className="review-sub">Paste a PGN. Your coach reviews every move — and she has opinions.</p>
      </div>

      {/* Coach panel */}
      <div className={`coach-panel mood-${moodBucket(mood)}`}>
        <div className="coach-figure">
          <CoachAvatar expression={expression} speaking={speaking} size={132} />
          <div className="mood-meter" aria-label={`mood ${mood} of 100`}>
            <div className="mood-fill" style={{ width: `${mood}%` }} />
          </div>
        </div>
        <div className="coach-say">
          <div className="coach-bubble">{bubble}</div>
          {curMove && (
            <div className="coach-verdict-row">
              <span className={`rv-chip rv-${REVIEW_META[curMove.reviewClass].cls}`}>
                {REVIEW_META[curMove.reviewClass].symbol} {REVIEW_META[curMove.reviewClass].label}
              </span>
              <span className="rv-san">{curMove.san}</span>
              <span className="rv-eval">{fmtEval(curMove.evalAfter)}</span>
            </div>
          )}
          <button
            className={`btn subtle voice-toggle ${settings.coachVoice ? 'on' : ''}`}
            aria-pressed={settings.coachVoice}
            onClick={() => settings.update({ coachVoice: !settings.coachVoice })}
          >
            {settings.coachVoice ? '🔊 Voice on' : '🔈 Voice off'}
          </button>
        </div>
      </div>

      {/* Input / progress */}
      {!review && (
        <div className={`review-import ${dragOver ? 'drag-over' : ''}`}>
          <textarea
            className="pgn-box"
            placeholder="Paste PGN here…"
            value={r.pgnText}
            onChange={(e) => r.setPgn(e.target.value)}
            spellCheck={false}
          />
          {r.error && <div className="review-error">{r.error}</div>}
          <div className="review-import-actions">
            <button className="btn primary" disabled={running} onClick={() => void r.run()}>
              {running ? 'Reviewing…' : 'Review my game'}
            </button>
            <button className="btn subtle" disabled={running} onClick={() => fileRef.current?.click()}>
              Open .pgn
            </button>
            <button
              className="btn subtle"
              disabled={running}
              onClick={() => {
                r.setPgn(SAMPLE_PGN);
              }}
            >
              Try a sample
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".pgn,.txt,text/plain,application/x-chess-pgn"
              hidden
              onChange={(e) => void handleFiles(e.target.files)}
            />
          </div>
          <p className="review-hint">…or drag a .pgn file anywhere onto this screen.</p>
        </div>
      )}

      {running && progress && (
        <div className="review-progress">
          <div className="review-progress-bar">
            <div
              className="review-progress-fill"
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
          <span>
            Studying move {Math.min(progress.done, progress.total)} of {progress.total}…
          </span>
          <button className="btn subtle" onClick={() => r.cancel()}>
            Cancel
          </button>
        </div>
      )}

      {/* Review body */}
      {review && game && (
        <>
          <div className="review-board-wrap">
            <ChessBoard
              fen={fen}
              orientation={orientation}
              interactive={false}
              lastMove={lastMove}
              arrow={bestArrow}
              sacArrow={sacArrow}
            />
          </div>

          <div className="review-nav">
            <button className="btn subtle" onClick={() => r.toStart()} disabled={viewPly === 0}>
              ⏮
            </button>
            <button className="btn subtle" onClick={() => r.prev()} disabled={viewPly === 0}>
              ‹
            </button>
            <span className="review-ply">
              {viewPly} / {n}
            </span>
            <button className="btn subtle" onClick={() => r.next()} disabled={viewPly === n}>
              ›
            </button>
            <button className="btn subtle" onClick={() => r.toEnd()} disabled={viewPly === n}>
              ⏭
            </button>
          </div>

          {/* Move strip */}
          <div className="move-strip">
            {review.moves.map((m, i) => (
              <button
                key={i}
                className={`move-chip rv-${REVIEW_META[m.reviewClass].cls} ${viewPly === i + 1 ? 'current' : ''}`}
                onClick={() => r.goToPly(i + 1)}
                title={`${REVIEW_META[m.reviewClass].label} — ${m.san}`}
              >
                <span className="mc-no">{i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : ''}</span>
                <span className="mc-san">{m.san}</span>
                <span className="mc-sym">{REVIEW_META[m.reviewClass].symbol}</span>
              </button>
            ))}
          </div>

          {/* Tally */}
          <div className="review-tally">
            <h3>Move tally</h3>
            <div className="tally-grid">
              {REVIEW_ORDER.map((c) => (
                <TallyRow key={c} cls={c} counts={review.countsByColor} />
              ))}
            </div>
            <div className="accuracy-row">
              <div className="acc-cell">
                <span className="acc-label">White accuracy</span>
                <span className="acc-val">{review.accuracy.w.toFixed(1)}%</span>
              </div>
              <div className="acc-cell">
                <span className="acc-label">Black accuracy</span>
                <span className="acc-val">{review.accuracy.b.toFixed(1)}%</span>
              </div>
            </div>
          </div>

          {/* Final verdict */}
          {verdict && (
            <div className={`verdict-card mood-${moodBucket(review.finalMood)}`}>
              <div className="verdict-face">
                <CoachAvatar expression={restingExpression(review.finalMood)} size={96} />
              </div>
              <div className="verdict-text">
                <h3>{verdict.title}</h3>
                <p>{verdict.line}</p>
                <button className="btn subtle" onClick={speakVerdict}>
                  🔊 Hear her verdict
                </button>
              </div>
            </div>
          )}

          <div className="review-footer">
            <button className="btn subtle" onClick={() => r.reset()}>
              Review another game
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TallyRow({
  cls,
  counts,
}: {
  cls: ReviewClass;
  counts: { w: Record<ReviewClass, number>; b: Record<ReviewClass, number> };
}) {
  const w = counts.w[cls];
  const b = counts.b[cls];
  const total = w + b;
  return (
    <div className={`tally-row ${total === 0 ? 'zero' : ''}`}>
      <span className={`rv-dot rv-${REVIEW_META[cls].cls}`}>{REVIEW_META[cls].symbol}</span>
      <span className="tally-label">{REVIEW_META[cls].label}</span>
      <span className="tally-count">
        <span className="tc-w">{w}</span>
        <span className="tc-sep">·</span>
        <span className="tc-b">{b}</span>
      </span>
    </div>
  );
}
