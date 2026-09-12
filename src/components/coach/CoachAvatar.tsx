import { memo } from 'react';
import type { Expression } from '../../lib/engine/review';

/**
 * The Game Review coach — an original, hand-drawn (all-SVG, offline, no
 * external art) anime-style commentator whose face swaps per move quality.
 * Deliberately stylized and tasteful: an expressive coach, nothing more.
 */

interface FaceCfg {
  brow: number; // vertical offset of eyebrows (— down = angrier/sadder)
  browTilt: number; // inner-end tilt in degrees (+ = worried/sad, − = cross)
  eye: 'open' | 'wide' | 'happy' | 'half' | 'heart' | 'down';
  mouth: 'smile' | 'grin' | 'soft' | 'flat' | 'small' | 'frown' | 'open' | 'wobble';
  blush: number; // 0..1
}

const FACES: Record<Expression, FaceCfg> = {
  smitten: { brow: -3, browTilt: 6, eye: 'heart', mouth: 'grin', blush: 1 },
  delighted: { brow: -2, browTilt: 4, eye: 'happy', mouth: 'grin', blush: 0.7 },
  pleased: { brow: -1, browTilt: 3, eye: 'open', mouth: 'smile', blush: 0.35 },
  neutral: { brow: 0, browTilt: 0, eye: 'open', mouth: 'soft', blush: 0.15 },
  thinking: { brow: 1, browTilt: -3, eye: 'half', mouth: 'small', blush: 0.1 },
  unimpressed: { brow: 2, browTilt: -6, eye: 'half', mouth: 'flat', blush: 0 },
  wince: { brow: 3, browTilt: 8, eye: 'half', mouth: 'small', blush: 0.2 },
  disappointed: { brow: 4, browTilt: 12, eye: 'down', mouth: 'frown', blush: 0 },
  shocked: { brow: -5, browTilt: 2, eye: 'wide', mouth: 'open', blush: 0.25 },
};

const SKIN = '#f4d6c4';
const SKIN_SH = '#e7bda8';
const HAIR = '#5b6ee0';
const HAIR_SH = '#4657cf';
const HAIR_HI = '#93a2ff';
const GOLD = '#e9ae4b';
const IRIS = '#e9ae4b';
const IRIS_SH = '#b9832f';
const BLUSH = '#ef8fa0';
const LINE = '#3a2f4a';
const MOUTH_IN = '#c25b6b';

function Eye({ x, cfg }: { x: number; cfg: FaceCfg }) {
  const y = 122;
  if (cfg.eye === 'happy') {
    // upturned closed "^" eyes
    return <path d={`M${x - 12} ${y + 3} Q${x} ${y - 12} ${x + 12} ${y + 3}`} className="coach-stroke" />;
  }
  if (cfg.eye === 'half') {
    return (
      <g>
        <path d={`M${x - 12} ${y - 3} Q${x} ${y + 9} ${x + 12} ${y - 3}`} className="coach-stroke" />
        <line x1={x - 12} y1={y - 4} x2={x + 12} y2={y - 4} className="coach-stroke" />
      </g>
    );
  }
  const heart = cfg.eye === 'heart';
  const rx = cfg.eye === 'wide' ? 15 : 13;
  const ry = cfg.eye === 'wide' ? 17 : 15;
  const pupilY = cfg.eye === 'down' ? y + 4 : y;
  return (
    <g>
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#fff" stroke={LINE} strokeWidth={1.6} />
      {heart ? (
        <path
          d={`M${x} ${pupilY + 7} C${x - 11} ${pupilY - 4} ${x - 5} ${pupilY - 11} ${x} ${pupilY - 5} C${x + 5} ${pupilY - 11} ${x + 11} ${pupilY - 4} ${x} ${pupilY + 7} Z`}
          fill="#ff5d7a"
        />
      ) : (
        <>
          <circle cx={x} cy={pupilY} r={cfg.eye === 'wide' ? 6.5 : 9} fill={IRIS} />
          <circle cx={x} cy={pupilY} r={cfg.eye === 'wide' ? 3.5 : 5} fill={IRIS_SH} />
          <circle cx={x} cy={pupilY} r={cfg.eye === 'wide' ? 2 : 3} fill={LINE} />
          <circle cx={x + 3} cy={pupilY - 4} r={2.2} fill="#fff" />
        </>
      )}
    </g>
  );
}

function mouthPath(kind: FaceCfg['mouth']): React.ReactNode {
  const x = 110;
  const y = 162;
  switch (kind) {
    case 'grin':
      return (
        <path
          d={`M${x - 15} ${y - 2} Q${x} ${y + 16} ${x + 15} ${y - 2} Q${x} ${y + 5} ${x - 15} ${y - 2} Z`}
          fill={MOUTH_IN}
          stroke={LINE}
          strokeWidth={1.4}
        />
      );
    case 'smile':
      return <path d={`M${x - 12} ${y - 1} Q${x} ${y + 10} ${x + 12} ${y - 1}`} className="coach-stroke" />;
    case 'soft':
      return <path d={`M${x - 9} ${y} Q${x} ${y + 5} ${x + 9} ${y}`} className="coach-stroke" />;
    case 'flat':
      return <line x1={x - 11} y1={y + 1} x2={x + 11} y2={y + 1} className="coach-stroke" />;
    case 'small':
      return <path d={`M${x - 5} ${y + 1} Q${x} ${y + 4} ${x + 5} ${y + 1}`} className="coach-stroke" />;
    case 'frown':
      return <path d={`M${x - 11} ${y + 5} Q${x} ${y - 5} ${x + 11} ${y + 5}`} className="coach-stroke" />;
    case 'wobble':
      return (
        <path
          d={`M${x - 12} ${y + 3} Q${x - 6} ${y - 3} ${x} ${y + 3} Q${x + 6} ${y + 9} ${x + 12} ${y + 3}`}
          className="coach-stroke"
        />
      );
    case 'open':
      return (
        <ellipse cx={x} cy={y + 3} rx={7} ry={10} fill={MOUTH_IN} stroke={LINE} strokeWidth={1.4} />
      );
  }
}

function Brow({ x, cfg, side }: { x: number; cfg: FaceCfg; side: 1 | -1 }) {
  const y = 96 + cfg.brow;
  // inner end toward the nose lifts/drops by tilt
  const innerDy = cfg.browTilt * side * -0.6;
  const inner = side === 1 ? x + 12 : x - 12;
  const outer = side === 1 ? x - 12 : x + 12;
  return (
    <line
      x1={inner}
      y1={y + innerDy}
      x2={outer}
      y2={y}
      className="coach-stroke"
      strokeWidth={3}
      strokeLinecap="round"
    />
  );
}

export const CoachAvatar = memo(function CoachAvatar({
  expression,
  speaking = false,
  size = 148,
}: {
  expression: Expression;
  speaking?: boolean;
  size?: number;
}) {
  const cfg = FACES[expression];
  return (
    <svg
      className={`coach-avatar${speaking ? ' speaking' : ''}`}
      viewBox="0 0 220 240"
      width={size}
      height={size}
      role="img"
      aria-label={`coach looking ${expression}`}
    >
      {/* back hair */}
      <path
        d="M40 118 C36 60 70 22 110 22 C150 22 184 60 180 118 C184 160 176 210 160 234 L60 234 C44 210 36 160 40 118 Z"
        fill={HAIR_SH}
      />
      {/* shoulders / collar */}
      <path d="M58 236 C64 200 88 186 110 186 C132 186 156 200 162 236 Z" fill="#2b2f3a" />
      <path d="M110 186 L100 210 L110 224 L120 210 Z" fill={GOLD} opacity={0.9} />
      {/* neck */}
      <path d="M96 168 L96 190 Q110 200 124 190 L124 168 Z" fill={SKIN_SH} />
      {/* face */}
      <ellipse cx={110} cy={120} rx={60} ry={68} fill={SKIN} />
      <path d="M50 120 Q52 168 92 182 Q70 168 66 120 Z" fill={SKIN_SH} opacity={0.5} />
      {/* ears */}
      <ellipse cx={50} cy={124} rx={9} ry={13} fill={SKIN} />
      <ellipse cx={170} cy={124} rx={9} ry={13} fill={SKIN} />
      {/* front hair / bangs */}
      <path
        d="M42 116 C36 58 72 24 110 24 C148 24 184 58 178 116 C170 92 156 78 150 96 C146 74 128 66 122 90 C118 66 102 66 98 90 C92 68 74 74 70 96 C64 78 50 92 42 116 Z"
        fill={HAIR}
      />
      <path d="M150 96 C156 78 170 92 178 116 C176 96 168 82 158 82 Z" fill={HAIR_HI} opacity={0.7} />
      {/* side locks */}
      <path d="M42 116 C40 150 44 176 54 194 L66 190 C58 168 56 140 58 116 Z" fill={HAIR} />
      <path d="M178 116 C180 150 176 176 166 194 L154 190 C162 168 164 140 162 116 Z" fill={HAIR} />
      {/* hair clip */}
      <g transform="translate(146 92) rotate(24)">
        <rect x={-3} y={-9} width={6} height={18} rx={3} fill={GOLD} />
        <rect x={-9} y={-3} width={18} height={6} rx={3} fill={GOLD} />
      </g>
      {/* brows */}
      <Brow x={86} cfg={cfg} side={-1} />
      <Brow x={134} cfg={cfg} side={1} />
      {/* eyes */}
      <Eye x={86} cfg={cfg} />
      <Eye x={134} cfg={cfg} />
      {/* nose */}
      <path d="M108 140 Q110 146 114 144" className="coach-stroke" strokeWidth={1.4} fill="none" />
      {/* blush */}
      {cfg.blush > 0 && (
        <g opacity={cfg.blush} fill={BLUSH}>
          <ellipse cx={74} cy={150} rx={12} ry={7} />
          <ellipse cx={146} cy={150} rx={12} ry={7} />
        </g>
      )}
      {/* mouth */}
      {mouthPath(cfg.mouth)}
    </svg>
  );
});
