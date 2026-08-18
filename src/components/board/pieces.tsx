import { memo } from 'react';
import type { Color, PieceSymbol } from '../../lib/chess/types';
import type { PieceStyle } from '../../state/settingsStore';

/**
 * Original piece set drawn on a 100x100 box — flat, modern silhouettes with a
 * soft ground shadow. No third-party piece art.
 */

interface GlyphProps {
  type: PieceSymbol;
  color: Color;
  style: PieceStyle;
}

const W = { fill: '#f8f4ea', stroke: '#3f3830', detail: '#b3a894' };
const B = { fill: '#2f2b27', stroke: '#171310', detail: '#9b917f' };

function palette(color: Color) {
  return color === 'w' ? W : B;
}

const Shadow = () => <ellipse cx={50} cy={87} rx={25} ry={4.5} fill="rgba(0,0,0,0.20)" />;

function Classic({ type, color }: { type: PieceSymbol; color: Color }) {
  const p = palette(color);
  const common = {
    fill: p.fill,
    stroke: p.stroke,
    strokeWidth: 3,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  };
  const detail = {
    fill: 'none',
    stroke: p.detail,
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
  };

  switch (type) {
    case 'p':
      return (
        <g>
          <Shadow />
          <g {...common}>
            <path d="M50 43 C41 43 36 49 36 54 C36 58 38.5 61.5 42 63.5 L37.5 75 C36 79 38.5 81 43 81 L57 81 C61.5 81 64 79 62.5 75 L58 63.5 C61.5 61.5 64 58 64 54 C64 49 59 43 50 43 Z" />
            <circle cx={50} cy={32} r={11.5} />
            <path d="M31 84 Q31 80 36 80 L64 80 Q69 80 69 84 L69 85.5 Q69 87 67 87 L33 87 Q31 87 31 85.5 Z" />
          </g>
        </g>
      );

    case 'r':
      return (
        <g>
          <Shadow />
          <g {...common}>
            <path d="M31 18 L41 18 L41 25 L46 25 L46 18 L54 18 L54 25 L59 25 L59 18 L69 18 L69 32 L63 38 L63 66 L69 73 L31 73 L37 66 L37 38 L31 32 Z" />
            <path d="M28 84 Q28 79 34 79 L66 79 Q72 79 72 84 L72 85.5 Q72 87 70 87 L30 87 Q28 87 28 85.5 Z" />
          </g>
          <path d="M41 38 L59 38 M41 66 L59 66" {...detail} />
        </g>
      );

    case 'n':
      return (
        <g>
          <Shadow />
          <g {...common}>
            <path d="M31 80 C31 64 34 54 42 47 C47 42.5 50 36 50 29 L51 21 C54 23 56.5 26 58 30 C67 33 73 41 75.5 51 C77 57.5 77 63 75.5 67 C74.5 69.7 71.5 69.6 70 67 L66.5 61 C65.5 59.2 63.5 58.8 61.5 60 L58 62 C55 63.7 52 62.3 52 59 C52 57 52.8 55.4 54.5 54 C50 55.5 46.5 59 45 64 C44 67.4 43.6 72 43.6 80 Z" />
            <path d="M27 84 Q27 79 33 79 L67 79 Q73 79 73 84 L73 85.5 Q73 87 71 87 L29 87 Q27 87 27 85.5 Z" />
          </g>
          <circle cx={55.5} cy={35} r={2.1} fill={p.stroke} stroke="none" />
          <path d="M49 27 C47 31 44 34 40 36" {...detail} />
        </g>
      );

    case 'b':
      return (
        <g>
          <Shadow />
          <g {...common}>
            <path d="M50 22 C59 31 64.5 40 64.5 50 C64.5 60 58.5 66.5 50 66.5 C41.5 66.5 35.5 60 35.5 50 C35.5 40 41 31 50 22 Z" />
            <circle cx={50} cy={14.5} r={5} />
            <path d="M37 79 L41.5 68 Q45.5 71 50 71 Q54.5 71 58.5 68 L63 79 Z" />
            <path d="M29 84 Q29 80 35 80 L65 80 Q71 80 71 84 L71 85.5 Q71 87 69 87 L31 87 Q29 87 29 85.5 Z" />
          </g>
          <path d="M50 36 L50 52 M43.5 44 L56.5 44" {...detail} />
        </g>
      );

    case 'q':
      return (
        <g>
          <Shadow />
          <g {...common}>
            <path d="M29.5 40 L36 62 L33 72 L67 72 L64 62 L70.5 40 L60 51 L55.5 33 L50 48 L44.5 33 L40 51 Z" />
            <circle cx={29} cy={35} r={4} />
            <circle cx={43.5} cy={27.5} r={4} />
            <circle cx={56.5} cy={27.5} r={4} />
            <circle cx={71} cy={35} r={4} />
            <circle cx={50} cy={23} r={4} />
            <path d="M28 84 Q28 79 34 79 L66 79 Q72 79 72 84 L72 85.5 Q72 87 70 87 L30 87 Q28 87 28 85.5 Z" />
          </g>
          <path d="M38 66 Q50 61 62 66" {...detail} />
        </g>
      );

    case 'k':
      return (
        <g>
          <Shadow />
          <g {...common}>
            <path d="M46.5 11 L53.5 11 L53.5 17 L59.5 17 L59.5 24 L53.5 24 L53.5 30 L46.5 30 L46.5 24 L40.5 24 L40.5 17 L46.5 17 Z" />
            <path d="M50 32 C61 32 68.5 38.5 69.5 47 L71 62 C71.5 68 68 72 62 72 L38 72 C32 72 28.5 68 29 62 L30.5 47 C31.5 38.5 39 32 50 32 Z" />
            <path d="M28 84 Q28 79 34 79 L66 79 Q72 79 72 84 L72 85.5 Q72 87 70 87 L30 87 Q28 87 28 85.5 Z" />
          </g>
          <path d="M37 49 Q50 42 63 49 M36.5 60 Q50 53 63.5 60" {...detail} />
        </g>
      );
  }
}

const LETTERS: Record<PieceSymbol, string> = { p: '', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };

function Minimal({ type, color }: { type: PieceSymbol; color: Color }) {
  const p = palette(color);
  if (type === 'p') {
    return (
      <g>
        <Shadow />
        <circle cx={50} cy={52} r={22} fill={p.fill} stroke={p.stroke} strokeWidth={4} />
        <circle cx={50} cy={52} r={9} fill="none" stroke={p.detail} strokeWidth={3} />
      </g>
    );
  }
  return (
    <g>
      <Shadow />
      <circle cx={50} cy={50} r={30} fill={p.fill} stroke={p.stroke} strokeWidth={4} />
      <text
        x={50}
        y={51}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={32}
        fontFamily="'Outfit', Georgia, serif"
        fontWeight={700}
        fill={color === 'w' ? W.stroke : B.detail}
      >
        {LETTERS[type]}
      </text>
    </g>
  );
}

export const PieceGlyph = memo(function PieceGlyph({ type, color, style }: GlyphProps) {
  return style === 'minimal' ? <Minimal type={type} color={color} /> : <Classic type={type} color={color} />;
});
