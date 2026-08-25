import { useCallback, useEffect, useRef, useState } from 'react';
import { detectBoard, readBoard, toGray, type Rect } from '../../lib/vision/boardImage';
import type { Color } from '../../lib/chess/types';

const DISPLAY_MAX = 480;

/**
 * "Scan a board image" flow: pick/paste a screenshot or photo, adjust the
 * auto-detected board square, choose whose move it is, and get a FEN back.
 */
export function ScanImport({
  onDone,
  onClose,
  initialFile,
}: {
  onDone: (fen: string, note: string) => void;
  onClose: () => void;
  /** start with this image already loaded (e.g. dropped onto the app) */
  initialFile?: File | null;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [turn, setTurn] = useState<Color>('w');
  const [fromBlackSide, setFromBlackSide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; rect: Rect } | null>(null);

  const scale = img ? Math.min(DISPLAY_MAX / img.naturalWidth, DISPLAY_MAX / img.naturalHeight, 1) : 1;

  const loadFile = useCallback((file: File) => {
    setError(null);
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      setImg(image);
      // detect on a downscaled copy for speed
      const dw = Math.min(512, image.naturalWidth);
      const dh = Math.round((image.naturalHeight / image.naturalWidth) * dw);
      const c = document.createElement('canvas');
      c.width = dw;
      c.height = dh;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0, dw, dh);
      const data = ctx.getImageData(0, 0, dw, dh);
      const found = detectBoard(toGray(data.data, dw, dh));
      const k = image.naturalWidth / dw;
      if (found) {
        setRect({ x: found.x * k, y: found.y * k, size: found.size * k });
      } else {
        const size = Math.min(image.naturalWidth, image.naturalHeight) * 0.92;
        setRect({
          x: (image.naturalWidth - size) / 2,
          y: (image.naturalHeight - size) / 2,
          size,
        });
      }
    };
    image.onerror = () => setError("Couldn't read that image file.");
    image.src = url;
  }, []);

  // image handed in from a drag-and-drop
  useEffect(() => {
    if (initialFile) loadFile(initialFile);
  }, [initialFile, loadFile]);

  // paste support
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) loadFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loadFile]);

  // draw preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    if (rect) {
      const rx = rect.x * scale;
      const ry = rect.y * scale;
      const rs = rect.size * scale;
      ctx.fillStyle = 'rgba(8,10,14,0.55)';
      ctx.fillRect(0, 0, w, ry);
      ctx.fillRect(0, ry + rs, w, h - ry - rs);
      ctx.fillRect(0, ry, rx, rs);
      ctx.fillRect(rx + rs, ry, w - rx - rs, rs);
      ctx.strokeStyle = '#e8a04f';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rs, rs);
      ctx.strokeStyle = 'rgba(232,160,79,0.35)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(rx + (rs * i) / 8, ry);
        ctx.lineTo(rx + (rs * i) / 8, ry + rs);
        ctx.moveTo(rx, ry + (rs * i) / 8);
        ctx.lineTo(rx + rs, ry + (rs * i) / 8);
        ctx.stroke();
      }
      // resize handle
      ctx.fillStyle = '#e8a04f';
      ctx.fillRect(rx + rs - 8, ry + rs - 8, 16, 16);
    }
  }, [img, rect, scale]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!rect) return;
    const box = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - box.left) / scale;
    const py = (e.clientY - box.top) / scale;
    const corner = Math.hypot(px - (rect.x + rect.size), py - (rect.y + rect.size));
    const mode = corner < 24 / scale ? 'resize' : 'move';
    dragRef.current = { mode, startX: px, startY: py, rect: { ...rect } };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d || !img) return;
    const box = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - box.left) / scale;
    const py = (e.clientY - box.top) / scale;
    if (d.mode === 'move') {
      const nx = Math.min(Math.max(0, d.rect.x + px - d.startX), img.naturalWidth - d.rect.size);
      const ny = Math.min(Math.max(0, d.rect.y + py - d.startY), img.naturalHeight - d.rect.size);
      setRect({ x: nx, y: ny, size: d.rect.size });
    } else {
      const size = Math.max(
        64,
        Math.min(
          d.rect.size + Math.max(px - d.startX, py - d.startY),
          img.naturalWidth - d.rect.x,
          img.naturalHeight - d.rect.y,
        ),
      );
      setRect({ x: d.rect.x, y: d.rect.y, size });
    }
  };
  const onPointerUp = () => (dragRef.current = null);

  const scan = () => {
    if (!img || !rect) return;
    setBusy(true);
    setError(null);
    // give React a frame to show the busy state before the sync work
    setTimeout(() => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height);
        const result = readBoard(data.data, c.width, c.height, rect, fromBlackSide);
        if (result.whitePieces + result.blackPieces < 2) {
          setError("Couldn't find pieces in that area — adjust the orange square so it covers the board exactly.");
          setBusy(false);
          return;
        }
        const fen = `${result.placement} ${turn} - - 0 1`;
        const note =
          `Read ${result.whitePieces + result.blackPieces} pieces from the image — ` +
          'check the board and fix anything that looks off, then tap Done.';
        onDone(fen, note);
      } catch {
        setError('Something went wrong reading the image.');
        setBusy(false);
      }
    }, 30);
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog scan-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Scan a board image</h2>
        {!img ? (
          <>
            <p className="field-hint">
              Use a screenshot or photo of a chess board (from any app or book). You can also
              paste an image from the clipboard.
            </p>
            <button className="btn primary big" onClick={() => fileRef.current?.click()}>
              Choose image
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFile(f);
                e.target.value = '';
              }}
            />
          </>
        ) : (
          <>
            <p className="field-hint">
              Line the orange square up with the board — drag to move, pull the corner to resize.
            </p>
            <canvas
              ref={canvasRef}
              className="scan-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            <div className="segment">
              <button
                className={turn === 'w' ? 'seg-btn active' : 'seg-btn'}
                onClick={() => setTurn('w')}
              >
                White to move
              </button>
              <button
                className={turn === 'b' ? 'seg-btn active' : 'seg-btn'}
                onClick={() => setTurn('b')}
              >
                Black to move
              </button>
            </div>
            <label className="toggle small">
              <span>Image is from Black's side of the board</span>
              <input
                type="checkbox"
                checked={fromBlackSide}
                onChange={(e) => setFromBlackSide(e.target.checked)}
              />
            </label>
            <div className="dialog-actions">
              <button className="btn primary" disabled={busy} onClick={scan}>
                {busy ? 'Reading…' : 'Read board'}
              </button>
              <button className="btn subtle" onClick={() => fileRef.current?.click()}>
                Other image
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadFile(f);
                  e.target.value = '';
                }}
              />
            </div>
          </>
        )}
        {error && <p className="field-error">{error}</p>}
        <button className="btn subtle" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
