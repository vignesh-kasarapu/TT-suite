import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, APPS, HIDDEN_UNLESS_GRANTED, type AppKey } from '../api';
import { Icon } from '../components/Icon';
import { Banner, Dialog, RoleBadge } from '../components/ui';
import { useMe } from '../useMe';
import s from '../styles/portal.module.css';

const LOOK: Record<AppKey, { icon: string; tint: string }> = {
  lms: { icon: 'calendar', tint: s.tint2 ?? '' },
  expense: { icon: 'receipt', tint: s.tint1 ?? '' },
  kanban: { icon: 'board', tint: s.tint3 ?? '' },
  ams: { icon: 'package', tint: s.tint2 ?? '' },
  resume: { icon: 'filecheck', tint: s.tint1 ?? '' },
};

/**
 * The app cards: only the apps the person has a role in. A card goes to /api/launch/<app>: the
 * portal authorizes the person's role for that app and then redirects into it. Apps without a role
 * have no card (and no app-switcher entry); a ?denied= banner still offers "Request access".
 */
export function Dashboard() {
  const { me } = useMe();
  const [params, setParams] = useSearchParams();
  const [asking, setAsking] = useState<AppKey | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const denied = params.get('denied') as AppKey | null;
  const unavailable = params.get('unavailable') as AppKey | null;
  const titleOf = (k: string | null) => APPS.find((a) => a.key === k)?.title ?? k;
  // Before the first Microsoft sign-in fills the name, greet by the email's first part.
  const base = me.name.includes('@') ? (me.name.split('@')[0] ?? '').split(/[._-]/)[0] ?? '' : me.name.split(/\s+/)[0] ?? '';
  const firstName = base ? base.charAt(0).toUpperCase() + base.slice(1) : me.name;
  // Only the apps the person can open: no card (and no switcher entry) for the others.
  const mine = APPS.filter((app) => me.access[app.key]);

  return (
    <>
      <div className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Welcome, {firstName}</h1>
          <p className={s.lead}>Choose an app to continue.</p>
        </div>
      </div>
      {denied ? (
        <Banner tone="danger" onClose={() => setParams({})}>
          You don't have access to <strong>{titleOf(denied)}</strong>.{' '}
          {HIDDEN_UNLESS_GRANTED.has(denied) ? null : (
            <button type="button" className={s.linkButton} onClick={() => setAsking(denied)}>Request access</button>
          )}
        </Banner>
      ) : null}
      {unavailable ? (
        <Banner onClose={() => setParams({})}>{titleOf(unavailable)} is starting up. Try again in a moment.</Banner>
      ) : null}
      {sent ? <Banner tone="ok" onClose={() => setSent(null)}>{sent}</Banner> : null}

      {mine.length === 0 ? (
        <section className={s.panel} data-testid="no-apps">
          <h2 className={s.cardTitle}>No apps yet</h2>
          <p className={s.muted}>You don't have access to any app yet. Your administrator gives access in Users &amp; access.</p>
        </section>
      ) : null}
      <section className={s.cards} aria-label="Apps">
        {mine.map((app) => {
          const role = me.access[app.key];
          const body = (
            <>
              <div className={s.row}>
                <span className={`${s.cardIcon} ${LOOK[app.key].tint}`}>
                  <Icon name={LOOK[app.key].icon} size={26} />
                </span>
                <span className={s.spacer} />
                <RoleBadge role={role} />
              </div>
              <div>
                <div className={s.cardShort}>{app.short}</div>
                <h2 className={s.cardTitle}>{app.title}</h2>
                <p className={s.muted}>{app.description}</p>
              </div>
              <div className={s.cardFoot}>
                <span className={s.open}>
                  Open <Icon name="arrow" size={18} />
                </span>
              </div>
            </>
          );
          return (
            <a key={app.key} className={s.card} href={`/api/launch/${app.key}`} data-testid={`card-${app.key}`}>
              {body}
            </a>
          );
        })}
      </section>

      {asking ? (
        <RequestAccess
          app={asking}
          title={titleOf(asking) ?? asking}
          onClose={() => setAsking(null)}
          onSent={() => {
            setAsking(null);
            setParams({});
            setSent('Your request was sent to the administrators.');
          }}
        />
      ) : null}
    </>
  );
}

function RequestAccess({ app, title, onClose, onSent }: { app: AppKey; title: string; onClose: () => void; onSent: () => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    try {
      await api('/api/me/request-access', { method: 'POST', body: JSON.stringify({ app, message }) });
      onSent();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={`Request access to ${title}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={`${s.button} ${s.secondary}`} onClick={onClose}>Cancel</button>
          <button type="button" className={s.button} disabled={busy} onClick={() => void send()}>Send request</button>
        </>
      }
    >
      <p className={s.muted}>You don't have access to {title} yet. Your administrators will get an email.</p>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <label className={s.field}>
        <span className={s.fieldLabel}>Message (optional)</span>
        <textarea className={s.textarea} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} />
      </label>
    </Dialog>
  );
}
