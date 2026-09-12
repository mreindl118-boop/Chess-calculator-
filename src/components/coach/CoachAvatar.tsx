import { memo, useId } from 'react';
import type { Expression } from '../../lib/engine/review';

/**
 * The Game Review coach — an original, hand-illustrated (all-SVG, offline,
 * no external art) anime-style commentator whose face swaps per move quality.
 * Layered like a real illustration: gradient skin and hair, weighted line
 * work, lashes, layered iris highlights and soft blush. Deliberately stylized
 * and tasteful: an expressive coach, nothing more.
 */

type EyeKind = 'open' | 'wide' | 'happy' | 'half' | 'heart' | 'down' | 'sparkle';
type MouthKind = 'grin' | 'smile' | 'soft' | 'flat' | 'small' | 'frown' | 'open' | 'pout';

interface FaceCfg {
  brow: number; // vertical offset of eyebrows (+ = lower)
  browTilt: number; // inner-end tilt (+ = worried/sad, − = cross)
  eye: EyeKind;
  mouth: MouthKind;
  blush: number; // 0..1
}

const FACES: Record<Expression, FaceCfg> = {
  smitten: { brow: -3, browTilt: 7, eye: 'heart', mouth: 'grin', blush: 1 },
  delighted: { brow: -2, browTilt: 4, eye: 'happy', mouth: 'grin', blush: 0.8 },
  pleased: { brow: -1, browTilt: 3, eye: 'sparkle', mouth: 'smile', blush: 0.4 },
  neutral: { brow: 0, browTilt: 0, eye: 'open', mouth: 'soft', blush: 0.18 },
  thinking: { brow: 1, browTilt: -3, eye: 'half', mouth: 'small', blush: 0.1 },
  unimpressed: { brow: 2, browTilt: -7, eye: 'half', mouth: 'flat', blush: 0 },
  wince: { brow: 3, browTilt: 9, eye: 'half', mouth: 'pout', blush: 0.25 },
  disappointed: { brow: 4, browTilt: 13, eye: 'down', mouth: 'frown', blush: 0 },
  shocked: { brow: -6, browTilt: 2, eye: 'wide', mouth: 'open', blush: 0.3 },
};

const FACE_PATH =
  'M56 104 C54 150 74 186 110 194 C146 186 166 150 164 104 C164 56 140 34 110 34 C80 34 56 56 56 104 Z';
// Broad bang strands: tips reach the top lids, the gaps between them stay
// shallow so the forehead only peeks through as small notches.
const BANGS_PATH =
  'M40 112 Q52 84 66 108 Q80 80 96 110 Q110 82 124 110 Q140 80 156 108 Q168 84 180 112 C186 48 144 20 110 20 C76 20 34 48 40 112 Z';

const LINE = '#2f2438';
const LINE_SOFT = '#5a4a66';
const MOUTH_IN = '#b84d63';
const TEETH = '#fff5f2';
const BLUSH = '#f28aa0';
const HEART = '#ff5f7e';

function Eye({ x, cfg, ids, side }: { x: number; cfg: FaceCfg; ids: Ids; side: 1 | -1 }) {
  const y = 126;
  const lashX = x + side * 15; // outer corner
  const lash = (
    <path
      d={`M${lashX - side * 2} ${y - 9} Q${lashX + side * 3} ${y - 12} ${lashX + side * 5} ${y - 15}`}
      stroke={LINE}
      strokeWidth={2.4}
      strokeLinecap="round"
      fill="none"
    />
  );

  if (cfg.eye === 'happy') {
    return (
      <g>
        <path
          d={`M${x - 13} ${y + 2} Q${x} ${y - 14} ${x + 13} ${y + 2}`}
          stroke={LINE}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
        />
        {lash}
      </g>
    );
  }
  if (cfg.eye === 'half') {
    return (
      <g>
        {/* white sliver + iris peeking under a heavy lid */}
        <clipPath id={`${ids.clip}-${side}`}>
          <path d={`M${x - 13} ${y - 2} Q${x} ${y + 12} ${x + 13} ${y - 2} Z`} />
        </clipPath>
        <path d={`M${x - 13} ${y - 2} Q${x} ${y + 12} ${x + 13} ${y - 2} Z`} fill="#fff" />
        <g clipPath={`url(#${ids.clip}-${side})`}>
          <ellipse cx={x} cy={y + 1} rx={8.5} ry={10} fill={`url(#${ids.iris})`} />
          <ellipse cx={x} cy={y + 2} rx={3.6} ry={5} fill={LINE} />
        </g>
        <path
          d={`M${x - 14} ${y - 2} Q${x} ${y - 8} ${x + 14} ${y - 2}`}
          stroke={LINE}
          strokeWidth={3.2}
          strokeLinecap="round"
          fill="none"
        />
        {lash}
      </g>
    );
  }

  const wide = cfg.eye === 'wide';
  const heart = cfg.eye === 'heart';
  const rx = wide ? 15 : 13;
  const ry = wide ? 18 : 15;
  const pupilY = cfg.eye === 'down' ? y + 4 : y;
  const irisR = wide ? 8 : 10;
  return (
    <g>
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#fff" />
      {heart ? (
        <path
          d={`M${x} ${pupilY + 9} C${x - 13} ${pupilY - 3} ${x - 6} ${pupilY - 13} ${x} ${pupilY - 6} C${x + 6} ${pupilY - 13} ${x + 13} ${pupilY - 3} ${x} ${pupilY + 9} Z`}
          fill={HEART}
        />
      ) : (
        <>
          <ellipse cx={x} cy={pupilY} rx={irisR} ry={irisR + 2.5} fill={`url(#${ids.iris})`} />
          <ellipse cx={x} cy={pupilY + 1} rx={wide ? 3.2 : 4.4} ry={wide ? 4.5 : 6} fill={LINE} />
          {/* layered highlights */}
          <circle cx={x - 3.5} cy={pupilY - 5} r={wide ? 2.6 : 3.4} fill="#fff" />
          <circle cx={x + 4} cy={pupilY + 4.5} r={1.6} fill="#fff" opacity={0.9} />
          {cfg.eye === 'sparkle' && (
            <path
              d={`M${x + 5} ${pupilY - 7} l1.2 2.2 2.2 1.2 -2.2 1.2 -1.2 2.2 -1.2 -2.2 -2.2 -1.2 2.2 -1.2 Z`}
              fill="#fff"
            />
          )}
        </>
      )}
      {/* upper lid: heavy weighted line */}
      <path
        d={`M${x - 14} ${y - 4} Q${x} ${y - ry - 4} ${x + 14} ${y - 4}`}
        stroke={LINE}
        strokeWidth={3.4}
        strokeLinecap="round"
        fill="none"
      />
      {/* lower lid: soft thin line */}
      <path
        d={`M${x - 10} ${y + ry - 3} Q${x} ${y + ry + 2} ${x + 10} ${y + ry - 3}`}
        stroke={LINE_SOFT}
        strokeWidth={1.3}
        strokeLinecap="round"
        fill="none"
      />
      {lash}
    </g>
  );
}

function Mouth({ kind }: { kind: MouthKind }) {
  const x = 110;
  const y = 166;
  const stroke = { stroke: LINE, strokeLinecap: 'round' as const, fill: 'none' };
  switch (kind) {
    case 'grin':
      return (
        <g>
          <path
            d={`M${x - 15} ${y - 2} Q${x} ${y + 18} ${x + 15} ${y - 2} Q${x} ${y + 4} ${x - 15} ${y - 2} Z`}
            fill={MOUTH_IN}
          />
          <path d={`M${x - 10} ${y} Q${x} ${y + 4} ${x + 10} ${y} L${x + 8} ${y + 3} Q${x} ${y + 6} ${x - 8} ${y + 3} Z`} fill={TEETH} />
          <path d={`M${x - 15} ${y - 2} Q${x} ${y + 18} ${x + 15} ${y - 2}`} {...stroke} strokeWidth={2} />
        </g>
      );
    case 'smile':
      return <path d={`M${x - 12} ${y - 1} Q${x} ${y + 11} ${x + 12} ${y - 1}`} {...stroke} strokeWidth={2.2} />;
    case 'soft':
      return <path d={`M${x - 8} ${y} Q${x} ${y + 5} ${x + 8} ${y}`} {...stroke} strokeWidth={2} />;
    case 'flat':
      return <path d={`M${x - 10} ${y + 1} L${x + 10} ${y + 1}`} {...stroke} strokeWidth={2} />;
    case 'small':
      return <path d={`M${x - 5} ${y + 1} Q${x} ${y + 4} ${x + 5} ${y + 1}`} {...stroke} strokeWidth={2} />;
    case 'pout':
      return (
        <path
          d={`M${x - 8} ${y + 3} Q${x - 4} ${y - 2} ${x} ${y + 2} Q${x + 4} ${y + 6} ${x + 8} ${y + 3}`}
          {...stroke}
          strokeWidth={2}
        />
      );
    case 'frown':
      return <path d={`M${x - 11} ${y + 5} Q${x} ${y - 5} ${x + 11} ${y + 5}`} {...stroke} strokeWidth={2.2} />;
    case 'open':
      return (
        <g>
          <ellipse cx={x} cy={y + 4} rx={7} ry={10} fill={MOUTH_IN} />
          <ellipse cx={x} cy={y + 4} rx={7} ry={10} {...stroke} strokeWidth={1.8} />
        </g>
      );
  }
}

function Brow({ x, cfg, side }: { x: number; cfg: FaceCfg; side: 1 | -1 }) {
  const y = 100 + cfg.brow;
  const innerDy = cfg.browTilt * -0.6;
  const inner = x - side * 13;
  const outer = x + side * 13;
  // tapered brow: thick at the inner-middle, thin at the outer tip
  return (
    <path
      d={`M${inner} ${y + innerDy} Q${x} ${y - 3} ${outer} ${y + 1}`}
      stroke={LINE}
      strokeWidth={3}
      strokeLinecap="round"
      fill="none"
    />
  );
}

interface Ids {
  skin: string;
  hair: string;
  hairHi: string;
  iris: string;
  clip: string;
  blush: string;
  face: string;
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
  const uid = useId().replace(/:/g, '');
  const ids: Ids = {
    skin: `ca-skin-${uid}`,
    hair: `ca-hair-${uid}`,
    hairHi: `ca-hairhi-${uid}`,
    iris: `ca-iris-${uid}`,
    clip: `ca-clip-${uid}`,
    blush: `ca-blush-${uid}`,
    face: `ca-face-${uid}`,
  };

  return (
    <svg
      className={`coach-avatar${speaking ? ' speaking' : ''}`}
      viewBox="0 0 220 240"
      width={size}
      height={size}
      role="img"
      aria-label={`coach looking ${expression}`}
    >
      <defs>
        <linearGradient id={ids.skin} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbe3d3" />
          <stop offset="1" stopColor="#f1c9b3" />
        </linearGradient>
        <linearGradient id={ids.hair} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7b7cf0" />
          <stop offset="0.55" stopColor="#5560dc" />
          <stop offset="1" stopColor="#3b45b8" />
        </linearGradient>
        <linearGradient id={ids.hairHi} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c4c9ff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#dfe2ff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#c4c9ff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={ids.iris} cx="0.5" cy="0.35" r="0.65">
          <stop offset="0" stopColor="#ffd98a" />
          <stop offset="0.55" stopColor="#e9a63f" />
          <stop offset="1" stopColor="#8d5a14" />
        </radialGradient>
        <radialGradient id={ids.blush} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={BLUSH} stopOpacity="0.85" />
          <stop offset="1" stopColor={BLUSH} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* back hair — big soft volume */}
      <path
        d="M34 122 C28 48 70 14 110 14 C150 14 192 48 186 122 C192 172 178 222 168 238 L52 238 C42 222 28 172 34 122 Z"
        fill={`url(#${ids.hair})`}
      />
      <path
        d="M40 130 C44 180 52 214 58 236 L74 236 C64 206 58 170 60 130 Z"
        fill="#3b45b8"
        opacity={0.45}
      />
      <path
        d="M180 130 C176 180 168 214 162 236 L146 236 C156 206 162 170 160 130 Z"
        fill="#3b45b8"
        opacity={0.45}
      />

      {/* shoulders / blouse */}
      <path d="M52 240 C58 202 84 188 110 188 C136 188 162 202 168 240 Z" fill="#2a2d3d" />
      <path d="M92 190 L110 214 L128 190 L120 188 L110 202 L100 188 Z" fill="#f4ede6" />
      <path d="M110 214 L104 236 L116 236 Z" fill="#e9ae4b" opacity={0.95} />

      {/* neck with shadow */}
      <path d="M96 170 L96 194 Q110 206 124 194 L124 170 Z" fill="#e5b79f" />

      {/* face */}
      <clipPath id={ids.face}>
        <path d={FACE_PATH} />
      </clipPath>
      <path d={FACE_PATH} fill={`url(#${ids.skin})`} />
      {/* cheek + jaw shading */}
      <path d="M58 118 Q60 166 96 188 Q74 172 68 118 Z" fill="#e7b39c" opacity={0.35} />
      <path d="M162 118 Q160 166 124 188 Q146 172 152 118 Z" fill="#e7b39c" opacity={0.25} />
      {/* bangs cast shadow: the bangs' own silhouette, offset down, clipped to the face */}
      <g clipPath={`url(#${ids.face})`}>
        <path d={BANGS_PATH} transform="translate(0 9)" fill="#d3987c" opacity={0.42} />
      </g>

      {/* ears */}
      <ellipse cx={55} cy={126} rx={8} ry={12} fill="#f4cdb8" />
      <ellipse cx={165} cy={126} rx={8} ry={12} fill="#f4cdb8" />

      {/* front hair: bangs in flowing strands */}
      <path d={BANGS_PATH} fill={`url(#${ids.hair})`} />
      {/* strand separations */}
      <path d="M72 96 Q84 100 92 108" stroke="#3b45b8" strokeWidth={1.4} fill="none" opacity={0.5} />
      <path d="M148 96 Q136 100 128 108" stroke="#3b45b8" strokeWidth={1.4} fill="none" opacity={0.5} />
      <path d="M110 84 Q112 96 118 108" stroke="#3b45b8" strokeWidth={1.2} fill="none" opacity={0.4} />
      {/* shine band */}
      <path d="M60 64 C80 40 140 40 168 64 C142 54 84 54 60 64 Z" fill={`url(#${ids.hairHi})`} />
      {/* ahoge */}
      <path d="M106 22 C100 8 118 4 122 14 C114 12 110 16 106 22 Z" fill="#7b7cf0" />

      {/* side locks in front of the ears */}
      <path d="M42 112 C38 150 42 184 54 204 L68 198 C58 172 56 140 60 112 Z" fill={`url(#${ids.hair})`} />
      <path d="M178 112 C182 150 178 184 166 204 L152 198 C162 172 164 140 160 112 Z" fill={`url(#${ids.hair})`} />

      {/* hair clip */}
      <g transform="translate(150 94) rotate(26)">
        <rect x={-3} y={-10} width={6} height={20} rx={3} fill="#e9ae4b" />
        <rect x={-10} y={-3} width={20} height={6} rx={3} fill="#e9ae4b" />
        <circle cx={0} cy={0} r={2.2} fill="#fff3d6" />
      </g>

      {/* brows */}
      <Brow x={86} cfg={cfg} side={-1} />
      <Brow x={134} cfg={cfg} side={1} />

      {/* eyes */}
      <Eye x={86} cfg={cfg} ids={ids} side={-1} />
      <Eye x={134} cfg={cfg} ids={ids} side={1} />

      {/* nose: a single soft accent */}
      <path d="M109 146 Q112 150 114 147" stroke={LINE_SOFT} strokeWidth={1.6} strokeLinecap="round" fill="none" />

      {/* blush: soft radial glow + anime hatch lines at high intensity */}
      {cfg.blush > 0 && (
        <g opacity={cfg.blush}>
          <ellipse cx={74} cy={152} rx={16} ry={9} fill={`url(#${ids.blush})`} />
          <ellipse cx={146} cy={152} rx={16} ry={9} fill={`url(#${ids.blush})`} />
          {cfg.blush >= 0.7 && (
            <g stroke="#e8778f" strokeWidth={1.3} strokeLinecap="round" opacity={0.8}>
              <path d="M68 156 l4 -6 M74 157 l4 -6 M80 156 l4 -6" />
              <path d="M138 156 l4 -6 M144 157 l4 -6 M150 156 l4 -6" />
            </g>
          )}
        </g>
      )}

      {/* mouth */}
      <Mouth kind={cfg.mouth} />
    </svg>
  );
});
