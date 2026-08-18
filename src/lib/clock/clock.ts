export interface TimeControl {
  /** base time in seconds */
  base: number;
  /** increment per move in seconds */
  inc: number;
}

export const CLOCK_PRESETS: Array<{ name: string; tc: TimeControl }> = [
  { name: '1+0', tc: { base: 60, inc: 0 } },
  { name: '3+2', tc: { base: 180, inc: 2 } },
  { name: '5+0', tc: { base: 300, inc: 0 } },
  { name: '10+0', tc: { base: 600, inc: 0 } },
  { name: '15+10', tc: { base: 900, inc: 10 } },
];

export type ClockSide = 'w' | 'b';

/**
 * Two-sided chess clock. Wall-clock accurate (performance.now deltas), ticks
 * a callback for display, fires onFlag exactly once.
 */
export class GameClock {
  remaining: Record<ClockSide, number>; // ms
  running: ClockSide | null = null;
  private lastStamp = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flagged = false;

  constructor(
    public readonly tc: TimeControl,
    private onTick?: (rem: Record<ClockSide, number>) => void,
    private onFlag?: (side: ClockSide) => void,
  ) {
    this.remaining = { w: tc.base * 1000, b: tc.base * 1000 };
  }

  start(side: ClockSide): void {
    if (this.flagged) return;
    this.sync();
    this.running = side;
    this.lastStamp = performance.now();
    if (!this.timer) {
      this.timer = setInterval(() => this.sync(), 100);
    }
  }

  /** The running side made a move: add increment, switch sides. */
  press(): void {
    if (!this.running || this.flagged) return;
    this.sync();
    if (this.flagged) return;
    const mover = this.running;
    this.remaining[mover] += this.tc.inc * 1000;
    this.start(mover === 'w' ? 'b' : 'w');
    this.onTick?.({ ...this.remaining });
  }

  pause(): void {
    this.sync();
    this.running = null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  stop(): void {
    this.pause();
  }

  private sync(): void {
    if (!this.running || this.flagged) return;
    const now = performance.now();
    const delta = now - this.lastStamp;
    this.lastStamp = now;
    this.remaining[this.running] = Math.max(0, this.remaining[this.running] - delta);
    this.onTick?.({ ...this.remaining });
    if (this.remaining[this.running] <= 0) {
      this.flagged = true;
      const side = this.running;
      this.pause();
      this.onFlag?.(side);
    }
  }

  /** restore a snapshot (game resume) */
  restore(rem: Record<ClockSide, number>): void {
    this.remaining = { ...rem };
  }

  snapshot(): Record<ClockSide, number> {
    this.sync();
    return { ...this.remaining };
  }
}

export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  if (totalSec >= 3600) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    return `${h}:${String(m).padStart(2, '0')}:${String(totalSec % 60).padStart(2, '0')}`;
  }
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (ms < 10000 && ms > 0) {
    return `0:${String(s).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}
