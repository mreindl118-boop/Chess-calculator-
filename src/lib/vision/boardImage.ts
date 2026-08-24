import type { Color, PieceSymbol } from '../chess/types';

/**
 * Reads a chess position out of a screenshot/photo of a 2D board — fully
 * in-browser, no ML runtime. Designed for clean digital boards (lichess,
 * chess.com, this app, book diagrams); the review step in the UI absorbs
 * any per-square mistakes.
 *
 * Pipeline: locate the board (9 evenly spaced grid edges in the gradient
 * profiles), slice into 64 cells, separate piece pixels from the square
 * background, then classify each silhouette with shape features (symmetry,
 * width profile, crown runs).
 */

export interface Gray {
  data: Float32Array; // luminance 0..255
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  size: number;
}

export interface CellResult {
  piece: { type: PieceSymbol; color: Color } | null;
  confidence: number; // 0..1, rough
}

export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Gray {
  const data = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    data[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return { data, width, height };
}

/**
 * Find the board square: gradient projections along x and y should each show
 * ~9 strong, evenly spaced peaks (the grid lines / color boundaries).
 * Returns null when nothing convincing is found (caller falls back to the
 * largest centered square and lets the user adjust).
 */
export function detectBoard(gray: Gray): Rect | null {
  const { width, height } = gray;
  const colEdge = new Float32Array(width);
  const rowEdge = new Float32Array(height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx = Math.abs(gray.data[i + 1] - gray.data[i - 1]);
      const gy = Math.abs(gray.data[i + width] - gray.data[i - width]);
      colEdge[x] += gx;
      rowEdge[y] += gy;
    }
  }
  const xs = gridFromProfile(colEdge);
  const ys = gridFromProfile(rowEdge);
  if (!xs || !ys) return null;
  const sizeX = xs.end - xs.start;
  const sizeY = ys.end - ys.start;
  // The board must be square-ish.
  if (Math.abs(sizeX - sizeY) > 0.06 * Math.max(sizeX, sizeY)) {
    const size = Math.min(sizeX, sizeY);
    return { x: xs.start, y: ys.start, size };
  }
  return { x: xs.start, y: ys.start, size: (sizeX + sizeY) / 2 };
}

/** Best run of 9 roughly evenly spaced peaks in an edge profile. */
function gridFromProfile(profile: Float32Array): { start: number; end: number } | null {
  const n = profile.length;
  // smooth
  const sm = new Float32Array(n);
  for (let i = 2; i < n - 2; i++) {
    sm[i] = (profile[i - 2] + profile[i - 1] + profile[i] + profile[i + 1] + profile[i + 2]) / 5;
  }
  // local maxima above the mean
  let mean = 0;
  for (let i = 0; i < n; i++) mean += sm[i];
  mean /= n;
  const peaks: number[] = [];
  for (let i = 2; i < n - 2; i++) {
    if (sm[i] > mean && sm[i] >= sm[i - 1] && sm[i] >= sm[i + 1]) {
      if (peaks.length && i - peaks[peaks.length - 1] < n * 0.02) {
        if (sm[i] > sm[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
      } else {
        peaks.push(i);
      }
    }
  }
  if (peaks.length < 4) return null;

  // Search for the best 9-line arithmetic progression (9 grid lines -> 8
  // cells). Any pair of peaks may be lines i and i+m of the grid, so derive
  // the step from every pair and extrapolate. A board flush with the image
  // edge has no gradient at its outer lines — the image boundary itself
  // counts as a matching line there.
  const minStep = Math.max(8, n * 0.04);
  let best: { start: number; end: number; score: number } | null = null;
  const consider = (start: number, step: number) => {
    const end = start + step * 8;
    if (start < -step * 0.3 || end > n - 1 + step * 0.3) return;
    const tol = Math.max(2, step * 0.15);
    let hits = 0;
    let err = 0;
    for (let k = 0; k <= 8; k++) {
      const target = start + k * step;
      let d = Infinity;
      for (const p of peaks) d = Math.min(d, Math.abs(p - target));
      if (target < tol) d = Math.min(d, Math.abs(target));
      if (target > n - 1 - tol) d = Math.min(d, Math.abs(n - 1 - target));
      if (d <= tol) {
        hits++;
        err += d / tol;
      }
    }
    if (hits < 7) return;
    const score = hits - err * 0.1 + (step * 8) / n;
    if (!best || score > best.score) best = { start, end, score };
  };
  for (let a = 0; a < peaks.length; a++) {
    for (let b = a + 1; b < peaks.length; b++) {
      const span = peaks[b] - peaks[a];
      for (let m = 1; m <= 8; m++) {
        const step = span / m;
        if (step < minStep || step > (n - 1) / 8 + 2) continue;
        for (let i = 0; i + m <= 8; i++) consider(peaks[a] - i * step, step);
      }
    }
  }
  return best ? { start: (best as { start: number }).start, end: (best as { end: number }).end } : null;
}

// ------------------------------------------------------------ cell reading

export interface Mask {
  on: Uint8Array; // 1 = piece pixel
  w: number;
  h: number;
  area: number;
}

const CELL = 48; // analysis resolution per cell

export function cellMask(
  rgba: Uint8ClampedArray,
  imgW: number,
  rect: Rect,
  file: number,
  rank: number,
): { mask: Mask; interiorLuma: number } {
  const cellSize = rect.size / 8;
  // slight inset so an off-by-a-pixel grid doesn't bleed the neighboring
  // square's color in along the cell edge
  const inset = cellSize * 0.05;
  const x0 = rect.x + file * cellSize + inset;
  const y0 = rect.y + rank * cellSize + inset;
  const span = cellSize - 2 * inset;

  // sample cell into CELL x CELL rgb
  const r = new Float32Array(CELL * CELL);
  const g = new Float32Array(CELL * CELL);
  const b = new Float32Array(CELL * CELL);
  for (let cy = 0; cy < CELL; cy++) {
    for (let cx = 0; cx < CELL; cx++) {
      const sx = Math.min(imgW - 1, Math.max(0, Math.round(x0 + ((cx + 0.5) / CELL) * span)));
      const sy = Math.max(0, Math.round(y0 + ((cy + 0.5) / CELL) * span));
      const p = (sy * imgW + sx) * 4;
      const i = cy * CELL + cx;
      r[i] = rgba[p];
      g[i] = rgba[p + 1];
      b[i] = rgba[p + 2];
    }
  }

  // Background color = median of the border ring (pieces rarely touch it).
  const ringR: number[] = [];
  const ringG: number[] = [];
  const ringB: number[] = [];
  for (let i = 0; i < CELL; i++) {
    for (const j of [0, 1, CELL - 2, CELL - 1]) {
      ringR.push(r[j * CELL + i], r[i * CELL + j]);
      ringG.push(g[j * CELL + i], g[i * CELL + j]);
      ringB.push(b[j * CELL + i], b[i * CELL + j]);
    }
  }
  const med = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1];
  const bgR = med(ringR);
  const bgG = med(ringG);
  const bgB = med(ringB);

  // Piece pixels differ from the background color. The gap can be small —
  // a cream piece fill on a light square — so pick the threshold per cell
  // with Otsu's split on the color-distance histogram, clamped to a sane
  // range so empty cells stay empty.
  const dist = new Float32Array(CELL * CELL);
  for (let i = 0; i < CELL * CELL; i++) {
    dist[i] = Math.abs(r[i] - bgR) + Math.abs(g[i] - bgG) + Math.abs(b[i] - bgB);
  }
  const threshold = Math.min(110, Math.max(55, otsu(dist, 320)));
  const on = new Uint8Array(CELL * CELL);
  for (let i = 0; i < CELL * CELL; i++) if (dist[i] > threshold) on[i] = 1;
  // Coordinate labels, dots and edge noise are separate small blobs — keep
  // only the piece: drop border-touching blobs (labels sit in square
  // corners) and specks, but keep detached piece parts (crown points,
  // the king's cross).
  cleanMask(on, CELL, CELL);
  // A piece fill close in color to its square (white piece on a light
  // square) leaves only the outline — and shading gaps can perforate that
  // outline. Close a COPY to seal the contour, find its enclosed holes, and
  // add just those interior pixels back to the original mask: silhouettes
  // become solid without smearing away detail (coronet points, the cross).
  const closed = on.slice();
  morphClose(closed, CELL, CELL, 2);
  const filled = closed.slice();
  fillHoles(filled, CELL, CELL);
  let area = 0;
  for (let i = 0; i < CELL * CELL; i++) {
    if (filled[i] && !closed[i]) on[i] = 1;
    if (on[i]) area++;
  }

  // one-step erosion for interior luminance (skip outlines)
  let lumSum = 0;
  let lumN = 0;
  for (let y = 1; y < CELL - 1; y++) {
    for (let x = 1; x < CELL - 1; x++) {
      const i = y * CELL + x;
      if (on[i] && on[i - 1] && on[i + 1] && on[i - CELL] && on[i + CELL]) {
        lumSum += 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];
        lumN++;
      }
    }
  }
  return {
    mask: { on, w: CELL, h: CELL, area },
    interiorLuma: lumN > 0 ? lumSum / lumN : 0.299 * bgR + 0.587 * bgG + 0.114 * bgB,
  };
}

/** Otsu's threshold over values clamped to [0, cap]. */
function otsu(values: Float32Array, cap: number): number {
  const BINS = 64;
  const hist = new Float32Array(BINS);
  for (let i = 0; i < values.length; i++) {
    const v = Math.min(cap, values[i]);
    hist[Math.min(BINS - 1, Math.floor((v / cap) * BINS))]++;
  }
  const total = values.length;
  let sumAll = 0;
  for (let t = 0; t < BINS; t++) sumAll += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let bestVar = -1;
  let bestT = 0;
  for (let t = 0; t < BINS; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      bestT = t;
    }
  }
  return ((bestT + 0.5) / BINS) * cap;
}

/** Morphological closing (dilate then erode, Chebyshev radius r) in place. */
function morphClose(on: Uint8Array, w: number, h: number, r: number): void {
  const tmp = new Uint8Array(w * h);
  const pass = (src: Uint8Array, dst: Uint8Array, val: 0 | 1) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let hit = false;
        for (let dy = -r; dy <= r && !hit; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx >= 0 && xx < w && src[yy * w + xx] === val) {
              hit = true;
              break;
            }
          }
        }
        dst[y * w + x] = hit ? val : ((1 - val) as 0 | 1);
      }
    }
  };
  pass(on, tmp, 1); // dilate
  pass(tmp, on, 0); // erode
}

/**
 * Remove non-piece blobs from a cell mask: components touching the cell
 * border (coordinate labels, bleed from neighbours) and tiny specks.
 * Detached piece parts — crown points, the king's cross — stay.
 */
function cleanMask(on: Uint8Array, w: number, h: number): void {
  const label = new Int32Array(w * h); // 0 = unvisited
  const areas: number[] = [0];
  const touches: boolean[] = [false];
  let next = 1;
  const stack: number[] = [];
  const sideStrip: boolean[] = [false]; // fully inside the left/right edge strips
  for (let s = 0; s < w * h; s++) {
    if (!on[s] || label[s]) continue;
    const id = next++;
    let area = 0;
    let touch = false;
    let minX = w;
    let maxX = -1;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      area++;
      const x = i % w;
      const y = (i / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) touch = true;
      const visit = (j: number) => {
        if (on[j] && !label[j]) {
          label[j] = id;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
    areas.push(area);
    touches.push(touch);
    // coordinate labels hug a square's left or right edge; piece parts are central
    sideStrip.push(maxX < w * 0.2 || minX > w * 0.8);
  }
  if (next <= 1) return;
  let total = 0;
  let borderArea = 0;
  for (let id = 1; id < next; id++) {
    total += areas[id];
    if (touches[id]) borderArea += areas[id];
  }
  // Only drop border-touchers when they're clearly incidental — a tightly
  // cropped piece photo may legitimately touch every edge.
  const dropBorder = borderArea < total * 0.5;
  const keep = new Array<boolean>(next).fill(true);
  let maxArea = 0;
  for (let id = 1; id < next; id++) {
    if ((dropBorder && touches[id]) || (sideStrip[id] && areas[id] < total * 0.5)) keep[id] = false;
    else maxArea = Math.max(maxArea, areas[id]);
  }
  const minArea = Math.max(6, maxArea * 0.03);
  for (let id = 1; id < next; id++) if (keep[id] && areas[id] < minArea) keep[id] = false;
  for (let i = 0; i < w * h; i++) if (on[i] && !keep[label[i]]) on[i] = 0;
}

/** Fill regions of "off" pixels not reachable from the border; returns the new on-area. */
function fillHoles(on: Uint8Array, w: number, h: number): number {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!seen[i] && !on[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  let area = 0;
  for (let i = 0; i < w * h; i++) {
    if (!on[i] && !seen[i]) on[i] = 1;
    if (on[i]) area++;
  }
  return area;
}

export interface Features {
  fill: number; // area / cell
  bboxH: number; // 0..1 of cell
  bboxW: number;
  asym: number; // horizontal asymmetry 0..1
  topRuns: number; // distinct runs near the top of the piece
  topFlat: boolean; // rook-style plateau top
  topWidthRel: number; // width near top / max width
  /** how solid the top band is (rook battlements ~0.7+, queen coronet ~0.4) */
  topDensity: number;
  /** fraction of piece height where the first pronounced width dip sits (pawn neck ~0.4, bishop ~0.65) */
  neckPos: number;
  /** where the widest row first occurs: rooks peak near the top, others at the base */
  maxWidthPos: number;
  rowWidths: number[];
}

export function maskFeatures(mask: Mask): Features | null {
  const { on, w, h } = mask;
  let minX = w,
    maxX = -1,
    minY = h,
    maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (on[y * w + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;

  // row widths and run counts within the bbox
  const rowWidths: number[] = [];
  const rowRuns: number[] = [];
  for (let y = minY; y <= maxY; y++) {
    let width = 0;
    let runs = 0;
    let inRun = false;
    for (let x = minX; x <= maxX; x++) {
      if (on[y * w + x]) {
        width++;
        if (!inRun) {
          runs++;
          inRun = true;
        }
      } else if (inRun && x + 2 <= maxX && !on[y * w + x + 1]) {
        // require a 2px gap to end a run (noise tolerance)
        inRun = false;
      }
    }
    rowWidths.push(width);
    rowRuns.push(runs);
  }
  const maxWidth = Math.max(...rowWidths, 1);

  // horizontal asymmetry: mirror the mask inside its bbox
  let diff = 0;
  let area = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const a = on[y * w + x];
      const m = on[y * w + (minX + (maxX - x))];
      if (a) area++;
      if (a !== m) diff++;
    }
  }
  const asym = area > 0 ? diff / (2 * area) : 0;

  // top band metrics (top 18% of the piece)
  const topBand = Math.max(2, Math.round(rowWidths.length * 0.18));
  const topRuns = Math.max(...rowRuns.slice(0, topBand));
  const topWidths = rowWidths.slice(0, topBand);
  const topWidthRel = Math.max(...topWidths) / maxWidth;
  const topMean = topWidths.reduce((a, b) => a + b, 0) / topWidths.length;
  const topVar =
    topWidths.reduce((a, b) => a + (b - topMean) * (b - topMean), 0) / topWidths.length;
  const topFlat = topWidthRel > 0.62 && Math.sqrt(topVar) < 0.12 * maxWidth;
  const topDensity = topMean / maxWidth;

  let maxWidthPos = 1;
  for (let i = 0; i < rowWidths.length; i++) {
    if (rowWidths[i] >= maxWidth * 0.96) {
      maxWidthPos = i / rowWidths.length;
      break;
    }
  }

  // First pronounced dip after a local peak (a "neck"), as a height fraction.
  let neckPos = 1;
  let peakSoFar = 0;
  for (let i = 0; i < rowWidths.length; i++) {
    peakSoFar = Math.max(peakSoFar, rowWidths[i]);
    if (peakSoFar >= maxWidth * 0.35 && rowWidths[i] < peakSoFar * 0.62) {
      neckPos = i / rowWidths.length;
      break;
    }
  }

  return {
    fill: mask.area / (w * h),
    bboxH: bh / h,
    bboxW: bw / w,
    asym,
    topRuns,
    topFlat,
    topWidthRel,
    topDensity,
    neckPos,
    maxWidthPos,
    rowWidths,
  };
}

function classifyPiece(f: Features, relHeight: number): { type: PieceSymbol; conf: number } {
  // relHeight = piece height / tallest piece height in the image
  // knight: asymmetric silhouette — but never among the tallest pieces
  // (a fragmented tall bishop can look asymmetric too)
  if (f.asym > 0.17 && relHeight < 0.88) return { type: 'n', conf: Math.min(1, f.asym * 3) };
  // rook: near-full-width flat or crenellated top; unlike a queen's spiky
  // coronet, the body narrows sharply right below the battlements while a
  // queen's head stays as wide as her crown
  const widths = f.rowWidths;
  const band = Math.max(2, Math.round(widths.length * 0.18));
  const topMaxAbs = Math.max(...widths.slice(0, band), 1);
  const waist = widths[Math.min(widths.length - 1, Math.round(widths.length * 0.35))] || 0;
  if (
    (f.topFlat || f.topRuns >= 2) &&
    f.topWidthRel > 0.72 &&
    (f.topDensity > 0.6 || (f.topDensity > 0.35 && waist < topMaxAbs * 0.75))
  ) {
    return { type: 'r', conf: 0.8 };
  }
  // queen: multi-point coronet — several distinct runs in a sparse top band
  if (f.topRuns >= 3) return { type: 'q', conf: 0.75 };
  // (a king's split cross also gives 2 sparse runs, but it pinches into a
  // neck right below — a queen's profile doesn't)
  if (f.topRuns >= 2 && f.topDensity < 0.4 && f.topWidthRel > 0.4 && f.neckPos > 0.5) {
    return { type: 'q', conf: 0.55 };
  }
  // pawn: a wide solid dome up top — no crown, cross, finial or
  // battlements (height alone is unreliable; the pawn/king gap is small)
  if (f.topRuns <= 2 && f.topWidthRel > 0.55 && f.topWidthRel < 0.78 && f.topDensity > 0.42) {
    return { type: 'p', conf: 0.75 };
  }
  // ...or clearly shorter than the tallest piece
  if (relHeight < 0.86) return { type: 'p', conf: relHeight < 0.8 ? 0.8 : 0.6 };
  // tall pieces: the king's cross widens the top band, the bishop tapers
  const rows = f.rowWidths;
  const maxW = Math.max(...rows, 1);
  const at = (frac: number) => rows[Math.min(rows.length - 1, Math.round(rows.length * frac))] || 0;
  const tip = Math.max(1, at(0.04));
  const crossZone = at(0.1);
  // the cross must be genuinely wide — a bishop's little finial ball also
  // sits detached above the head, but stays narrow
  if (crossZone > tip * 1.9 && crossZone >= maxW * 0.28 && at(0.18) < crossZone * 0.85) {
    return { type: 'k', conf: 0.7 };
  }
  if (f.topWidthRel > 0.41 || f.topDensity > 0.38) return { type: 'k', conf: 0.55 };
  // a split cross also shows as 2 sparse runs pinching into an early neck
  if (f.topRuns >= 2 && f.neckPos < 0.3) return { type: 'k', conf: 0.5 };
  return { type: 'b', conf: 0.6 };
}

export interface ReadBoardResult {
  cells: CellResult[]; // 64, a8..h1 reading order
  /** placement-only FEN field (no side/castling) */
  placement: string;
  whitePieces: number;
  blackPieces: number;
}

export function readBoard(
  rgba: Uint8ClampedArray,
  imgW: number,
  _imgH: number,
  rect: Rect,
  fromBlackSide = false,
): ReadBoardResult {
  // First pass: masks + features for every occupied cell.
  const raw: Array<{ mask: Mask; interiorLuma: number; features: Features | null }> = [];
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const { mask, interiorLuma } = cellMask(rgba, imgW, rect, file, rank);
      const occupied = mask.area > CELL * CELL * 0.06 && mask.area < CELL * CELL * 0.85;
      raw.push({
        mask,
        interiorLuma,
        features: occupied ? maskFeatures(mask) : null,
      });
    }
  }

  const heights = raw
    .map((c) => (c.features ? c.features.bboxH : 0))
    .filter((v) => v > 0)
    .sort((a, b) => b - a);
  const tallest = heights[0] || 1;

  const cells: CellResult[] = raw.map((c) => {
    const f = c.features;
    if (!f) return { piece: null, confidence: 1 };
    // very thin masks are stray coordinate labels / dots, not pieces
    if (f.bboxH < 0.25 || f.bboxW < 0.15) return { piece: null, confidence: 0.6 };
    const color: Color = c.interiorLuma >= 128 ? 'w' : 'b';
    const { type, conf } = classifyPiece(f, f.bboxH / tallest);
    return { piece: { type, color }, confidence: conf };
  });

  // Constraint pass: each side keeps only its single best king; extra "kings"
  // become queens (the most common confusion).
  for (const color of ['w', 'b'] as Color[]) {
    const kings = cells
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.piece?.type === 'k' && c.piece.color === color)
      .sort((a, b) => b.c.confidence - a.c.confidence);
    for (const extra of kings.slice(1)) {
      cells[extra.i] = {
        piece: { type: 'q', color },
        confidence: extra.c.confidence * 0.8,
      };
    }
  }

  const ordered = fromBlackSide ? [...cells].reverse() : cells;
  let placement = '';
  let whitePieces = 0;
  let blackPieces = 0;
  for (let rank = 0; rank < 8; rank++) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const cell = ordered[rank * 8 + file];
      if (!cell.piece) {
        empty++;
        continue;
      }
      if (empty > 0) {
        placement += empty;
        empty = 0;
      }
      const ch = cell.piece.type;
      placement += cell.piece.color === 'w' ? ch.toUpperCase() : ch;
      if (cell.piece.color === 'w') whitePieces++;
      else blackPieces++;
    }
    if (empty > 0) placement += empty;
    if (rank < 7) placement += '/';
  }

  return { cells: ordered, placement, whitePieces, blackPieces };
}
