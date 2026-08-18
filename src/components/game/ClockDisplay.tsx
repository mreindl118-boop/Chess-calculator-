import { formatClock } from '../../lib/clock/clock';

export function ClockDisplay({
  ms,
  active,
  lowTime,
}: {
  ms: number;
  active: boolean;
  lowTime?: boolean;
}) {
  return (
    <div className={`clock ${active ? 'active' : ''} ${lowTime || ms < 15000 ? 'low' : ''}`}>
      {formatClock(ms)}
    </div>
  );
}
