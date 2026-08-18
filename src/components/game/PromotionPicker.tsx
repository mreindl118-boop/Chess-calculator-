import type { Color } from '../../lib/chess/types';
import { PieceGlyph } from '../board/pieces';
import { useSettings } from '../../state/settingsStore';

const CHOICES = ['q', 'r', 'b', 'n'] as const;

export function PromotionPicker({
  color,
  onPick,
  onCancel,
}: {
  color: Color;
  onPick: (p: 'q' | 'r' | 'b' | 'n') => void;
  onCancel: () => void;
}) {
  const { pieceStyle } = useSettings();
  return (
    <div className="promo-overlay" onClick={onCancel}>
      <div className="promo-picker" onClick={(e) => e.stopPropagation()}>
        {CHOICES.map((p) => (
          <button key={p} className="promo-choice" onClick={() => onPick(p)} aria-label={p}>
            <svg viewBox="0 0 100 100">
              <PieceGlyph type={p} color={color} style={pieceStyle} />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
