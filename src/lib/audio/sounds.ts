/**
 * Synthesized game sounds via WebAudio — zero binary assets, instant, and
 * they work offline by construction. All calls are fire-and-forget and safe
 * before user interaction (they just no-op until the context can start).
 */

type SoundName = 'move' | 'capture' | 'check' | 'lowtime' | 'gameend' | 'illegal';

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

function tone(
  ac: AudioContext,
  freq: number,
  start: number,
  duration: number,
  type: OscillatorType,
  gain: number,
): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function thock(ac: AudioContext, start: number, freq: number, gain: number): void {
  // Short filtered noise burst — reads as a piece landing on wood.
  const len = Math.floor(ac.sampleRate * 0.06);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(start);
}

export function playSound(name: SoundName): void {
  if (!enabled) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  switch (name) {
    case 'move':
      thock(ac, t, 900, 0.5);
      break;
    case 'capture':
      thock(ac, t, 600, 0.7);
      thock(ac, t + 0.03, 1200, 0.35);
      break;
    case 'check':
      thock(ac, t, 900, 0.4);
      tone(ac, 880, t + 0.02, 0.18, 'sine', 0.12);
      break;
    case 'lowtime':
      tone(ac, 1320, t, 0.08, 'square', 0.06);
      tone(ac, 1320, t + 0.12, 0.08, 'square', 0.06);
      break;
    case 'gameend':
      tone(ac, 523, t, 0.15, 'sine', 0.12);
      tone(ac, 659, t + 0.12, 0.15, 'sine', 0.12);
      tone(ac, 784, t + 0.24, 0.3, 'sine', 0.12);
      break;
    case 'illegal':
      tone(ac, 160, t, 0.12, 'sawtooth', 0.08);
      break;
  }
}
