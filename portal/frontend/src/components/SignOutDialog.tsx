import { useEffect, useRef, useState } from 'react';
import { api, type Device } from '../api';
import { Banner } from './ui';
import s from '../styles/portal.module.css';

/** "Sign out" as a card over the page: this device, or every device the person is signed in on.
 * Every suite app opens the same card from its top bar (the /signout page stays as a fallback). */
export function SignOutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setDevices(null);
      setError(null);
      dialog.showModal();
      api<{ items: Device[] }>('/api/me/sessions').then((d) => setDevices(d.items)).catch(() => setDevices([]));
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  async function signOut(everywhere: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ everywhere }) });
      window.location.assign('/login');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const count = devices?.length ?? 0;
  return (
    <dialog
      ref={ref}
      className={`${s.dialog} ${s.signOutDialog}`}
      aria-labelledby="signout-h"
      data-testid="signout-dialog"
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={s.dialogBody}>
        <div>
          <h2 id="signout-h" className={s.cardTitle}>Sign out</h2>
          <p className={s.muted}>
            {devices === null
              ? 'Checking where you are signed in…'
              : count > 1
                ? `You're signed in on ${count} devices.`
                : count === 1 ? "You're signed in on this device only." : ''}
          </p>
        </div>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <div className={s.signOutActions}>
          <button type="button" className={s.button} disabled={busy} onClick={() => void signOut(false)} data-testid="signout-this">
            Sign out of this device
          </button>
          <button type="button" className={`${s.button} ${s.secondary}`} disabled={busy} onClick={() => void signOut(true)} data-testid="signout-all">
            Sign out of all devices{count > 1 ? ` (${count})` : ''}
          </button>
          <button type="button" className={`${s.button} ${s.ghost}`} disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
