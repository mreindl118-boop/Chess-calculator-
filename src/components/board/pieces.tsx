import { memo } from 'react';
import type { Color, PieceSymbol } from '../../lib/chess/types';
import type { PieceStyle } from '../../state/settingsStore';

/**
 * Original piece glyphs drawn on a 100x100 box (no third-party piece sets).
 * 'classic' is a silhouette set built from primitives; 'minimal' is a filled
 * roundel with a letterform — extremely readable at small sizes.
 */

interface GlyphProps {
  type: PieceSymbol;
  color: Color;
  style: PieceStyle;
}

const LIGHT_FILL = '#f4f0e6';
const LIGHT_STROKE = '#3a3630';
const DARK_FILL = '#33302c';
const DARK_STROKE = '#0f0e0c';
const DARK_DETAIL = '#8f887c';

function palette(color: Color) {
  return color === 'w'
    ? { fill: LIGHT_FILL, stroke: LIGHT_STROKE, detail: LIGHT_STROKE }
    : { fill: DARK_FILL, stroke: DARK_STROKE, detail: DARK_DETAIL };
}

const BASE = 'M22 88 Q22 80 30 78 L70 78 Q78 80 78 88 L78 90 L22 90 Z';

function Classic({ type, color }: { type: PieceSymbol; color: Color }) {
  const p = palette(color);
  const common = {
    fill: p.fill,
    stroke: p.stroke,
    strokeWidth: 3.5,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  };
  switch (type) {
    case 'p':
      return (
        <g {...common}>
          <circle cx={50} cy={30} r={12} />
          <path d="M38 62 Q38 46 50 44 Q62 46 62 62 L66 78 L34 78 Z" />
          <path d={BASE} />
        </g>
      );
    case 'r':
      return (
        <g {...common}>
          <path d="M30 24 L30 36 L37 40 L34 72 L66 72 L63 40 L70 36 L70 24 L60 24 L60 30 L55 30 L55 24 L45 24 L45 30 L40 30 L40 24 Z" />
          <path d={BASE} />
        </g>
      );
    case 'n':
      return (
        <g {...common}>
          <path d="M33 78 L33 66 Q33 46 46 38 Q50 30 50 22 Q56 24 58 30 Q74 36 76 52 Q77 60 74 66 L64 62 Q64 52 56 50 Q42 58 44 78 Z" />
          <path d="M60 34 Q66 36 68 42" fill="none" />
          <circle cx={58} cy={38} r={2.2} fill={p.stroke} stroke="none" />
          <path d={BASE} />
        </g>
      );
    case 'b':
      return (
        <g {...common}>
          <circle cx={50} cy={20} r={5} />
          <path d="M50 26 Q66 38 64 54 Q62 66 50 68 Q38 66 36 54 Q34 38 50 26 Z" />
          <path d="M50 38 L50 52 M44 45 L56 45" fill="none" strokeWidth={3} />
          <path d="M38 78 L42 68 L58 68 L62 78 Z" />
          <path d={BASE} />
        </g>
      );
    case 'q':
      return (
        <g {...common}>
          <path d="M26 34 L36 60 L32 72 L68 72 L64 60 L74 34 L62 48 L57 30 L50 46 L43 30 L38 48 Z" />
          <circle cx={26} cy={30} r={4} />
          <circle cx={43} cy={25} r={4} />
          <circle cx={57} cy={25} r={4} />
          <circle cx={74} cy={30} r={4} />
          <circle cx={50} cy={20} r={4} />
          <path d={BASE} />
        </g>
      );
    case 'k':
      return (
        <g {...common}>
          <path d="M46 14 L54 14 L54 20 L60 20 L60 28 L54 28 L54 34 L46 34 L46 28 L40 28 L40 20 L46 20 Z" />
          <path d="M34 40 Q50 30 66 40 L70 66 L64 74 L36 74 L30 66 Z" />
          <path d="M40 52 Q50 44 60 52" fill="none" />
          <path d={BASE} />
        </g>
      );
  }
}

const LETTERS: Record<PieceSymbol, string> = {
  p: '',
  n: 'N',
  b: 'B',
  r: 'R',
  q: 'Q',
  k: 'K',
};

function Minimal({ type, color }: { type: PieceSymbol; color: Color }) {
  const p = palette(color);
  if (type === 'p') {
    return (
      <g>
        <circle cx={50} cy={54} r={22} fill={p.fill} stroke={p.stroke} strokeWidth={4} />
        <circle cx={50} cy={54} r={9} fill="none" stroke={p.detail} strokeWidth={3} />
      </g>
    );
  }
  return (
    <g>
      <circle cx={50} cy={52} r={30} fill={p.fill} stroke={p.stroke} strokeWidth={4} />
      <text
        x={50}
        y={52}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={34}
        fontFamily="Georgia, 'Times New Roman', serif"
        fontWeight={700}
        fill={color === 'w' ? LIGHT_STROKE : DARK_DETAIL}
      >
        {LETTERS[type]}
      </text>
    </g>
  );
}

export const PieceGlyph = memo(function PieceGlyph({ type, color, style }: GlyphProps) {
  return style === 'minimal' ? <Minimal type={type} color={color} /> : <Classic type={type} color={color} />;
});
