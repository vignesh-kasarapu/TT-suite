import { useEffect, useState } from 'react';
import { api, describeDevice, timeAgo, type Device } from '../api';
import { Banner } from '../components/ui';
import s from '../styles/portal.module.css';

/** Every app's "Sign out" comes here: this device only, or every device the person is signed in on. */
export function SignOut() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: Device[] }>('/api/me/sessions').then((d) => setDevices(d.items)).catch(() => setDevices([]));
  }, []);

  async function signOut(everywhere: boolean) {
    setBusy(true);
    try {
      await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ everywhere }) });
      window.location.assign('/login');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const others = devices ? devices.length - 1 : 0;
  return (
    <div className={`${s.stack} ${s.narrow}`}>
      <div className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Sign out</h1>
          <p className={s.lead}>
            {devices === null
              ? 'Checking where you are signed in…'
              : others > 0
                ? `You are signed in on ${devices.length} devices.`
                : 'You are signed in on this device only.'}
          </p>
        </div>
      </div>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {devices && devices.length > 0 ? (
        <section className={s.panel} aria-label="Devices">
          <ul className={s.inboxList}>
            {devices.map((d) => (
              <li key={d.createdAt + d.userAgent} className={s.messageItem}>
                <div className={s.personCell}>
                  <strong>{describeDevice(d.userAgent)}{d.current ? ' (this device)' : ''}</strong>
                  <span className={s.caption}>Signed in {timeAgo(d.createdAt)} · last active {timeAgo(d.lastSeenAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className={s.row}>
        <button type="button" className={s.button} disabled={busy} onClick={() => void signOut(false)} data-testid="signout-this">
          Sign out of this device
        </button>
        <button type="button" className={`${s.button} ${s.secondary}`} disabled={busy} onClick={() => void signOut(true)} data-testid="signout-all">
          Sign out of all devices{others > 0 ? ` (${devices?.length})` : ''}
        </button>
        <button type="button" className={s.linkButton} disabled={busy} onClick={() => window.history.length > 1 ? window.history.back() : window.location.assign('/')}>
          Cancel
        </button>
      </div>
      <p className={s.caption}>Signing out applies to the dashboard and every app (Leave, Expense, Kanban, Assets).</p>
    </div>
  );
}
