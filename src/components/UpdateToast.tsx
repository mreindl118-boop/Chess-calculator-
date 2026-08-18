import { useEffect, useState } from 'react';
import { registerSW } from '../lib/platform/sw';

export function UpdateToast() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [apply, setApply] = useState<(() => void) | null>(null);

  useEffect(() => {
    registerSW((applyUpdate) => {
      setApply(() => applyUpdate);
      setNeedRefresh(true);
    });
  }, []);

  if (!needRefresh) return null;
  return (
    <div className="update-toast">
      <span>Update ready</span>
      <button
        className="btn primary"
        onClick={() => {
          apply?.();
        }}
      >
        Restart
      </button>
      <button className="btn subtle" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
    </div>
  );
}
