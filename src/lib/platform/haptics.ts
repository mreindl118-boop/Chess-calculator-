import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

let enabled = true;
export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

const native = Capacitor.isNativePlatform();

export function tapHaptic(strength: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (!enabled) return;
  if (native) {
    const style =
      strength === 'heavy'
        ? ImpactStyle.Heavy
        : strength === 'medium'
          ? ImpactStyle.Medium
          : ImpactStyle.Light;
    void Haptics.impact({ style }).catch(() => {});
  } else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(strength === 'heavy' ? 30 : strength === 'medium' ? 20 : 10);
  }
}
