import { Workbox } from 'workbox-window';

/**
 * Service-worker registration with the standard update flow:
 * detect a waiting worker -> surface "Update ready" -> on confirm,
 * skipWaiting + reload.
 */
export function registerSW(onUpdateReady: (apply: () => void) => void): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;

  const wb = new Workbox('/sw.js');

  const apply = () => {
    wb.addEventListener('controlling', () => {
      window.location.reload();
    });
    void wb.messageSkipWaiting();
  };

  wb.addEventListener('waiting', () => onUpdateReady(apply));
  void wb.register();
}
