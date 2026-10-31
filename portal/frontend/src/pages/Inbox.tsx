import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, APPS, roleLabel, timeAgo, type InboxItem, type RoleRequest } from '../api';
import { Banner } from '../components/ui';
import { useMe } from '../useMe';
import s from '../styles/portal.module.css';

const appTitle = (key: string) => APPS.find((a) => a.key === key)?.title ?? key;

/** Inbox filters: error alerts, things waiting for an approval, and everything else. */
type Show = 'all' | 'errors' | 'approvals' | 'others';
const SHOWS: { key: Show; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'errors', label: 'Errors' },
  { key: 'approvals', label: 'Approvals needed' },
  { key: 'others', label: 'Others' },
];
const categoryOf = (kind: string): Exclude<Show, 'all'> =>
  kind === 'error' ? 'errors' : kind === 'role_request' ? 'approvals' : 'others';

/** One inbox for the suite: messages for everyone, and for global admins the role requests to decide. */
export function Inbox() {
  const { me, setMe } = useMe();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [requests, setRequests] = useState<RoleRequest[]>([]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  // The filter lives in the URL (?show=errors), so a link can open the inbox on it.
  const [params, setParams] = useSearchParams();
  const show: Show = SHOWS.some((f) => f.key === params.get('show')) ? (params.get('show') as Show) : 'all';
  const pick = (key: Show) => setParams(key === 'all' ? {} : { show: key }, { replace: true });

  const load = useCallback(async () => {
    const box = await api<{ items: InboxItem[]; unreadCount: number }>('/api/me/inbox');
    setItems(box.items);
    if (me.isGlobalAdmin) setRequests((await api<{ items: RoleRequest[] }>('/api/admin/role-requests')).items);
    if (box.unreadCount > 0) {
      // Opening the inbox reads it; the unread ones stay highlighted until the next visit.
      await api('/api/me/inbox/read', { method: 'POST', body: JSON.stringify({}) });
      setMe({ ...me, unreadCount: 0 });
    }
  }, [me, setMe]);

  useEffect(() => {
    void load().catch((e) => setNotice({ tone: 'danger', text: (e as Error).message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(req: RoleRequest, approve: boolean) {
    setBusy(req.id);
    setNotice(null);
    try {
      await api(`/api/admin/role-requests/${req.id}/${approve ? 'approve' : 'decline'}`, {
        method: 'POST',
        body: JSON.stringify({ note: notes[req.id] ?? '' }),
      });
      setNotice({
        tone: 'ok',
        text: approve
          ? `${req.name} is now ${roleLabel(req.role)} in ${appTitle(req.app)}.`
          : `Declined: ${req.name} → ${roleLabel(req.role)} in ${appTitle(req.app)}.`,
      });
      setRequests((await api<{ items: RoleRequest[] }>('/api/admin/role-requests')).items);
    } catch (e) {
      setNotice({ tone: 'danger', text: `${appTitle(req.app)} did not apply it: ${(e as Error).message} The request is still open.` });
    } finally {
      setBusy(null);
    }
  }

  const pending = requests.filter((r) => r.status === 'pending');
  const decided = requests.filter((r) => r.status !== 'pending');
  const shown = items?.filter((m) => show === 'all' || categoryOf(m.kind) === show) ?? null;
  // Each chip counts the messages it shows, so the three add up to All; open role requests have
  // their own badge on "Waiting for your decision".
  const countOf = (key: Show) => items?.filter((m) => key === 'all' || categoryOf(m.kind) === key).length ?? 0;
  const showRequests = me.isGlobalAdmin && (show === 'all' || show === 'approvals');

  return (
    <div className={s.stack}>
      <div className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Inbox</h1>
          <p className={s.lead}>
            {me.isGlobalAdmin ? 'Role requests waiting for you, and your messages.' : 'Your messages from the Tektalis Suite.'}
          </p>
        </div>
      </div>
      {notice ? <Banner tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Banner> : null}

      <div className={s.inboxFilters} role="group" aria-label="Show" data-testid="inbox-filters">
        {SHOWS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={s.filterChip}
            aria-pressed={show === f.key}
            onClick={() => pick(f.key)}
            data-testid={`inbox-filter-${f.key}`}
          >
            {f.label}
            <span className={s.filterCount}>{countOf(f.key)}</span>
          </button>
        ))}
      </div>

      {showRequests ? (
        <section className={s.panel} aria-labelledby="requests-h">
          <h2 id="requests-h" className={s.cardTitle}>
            Waiting for your decision {pending.length ? <span className={`${s.badge} ${s.badgeWarn}`}>{pending.length}</span> : null}
          </h2>
          {pending.length === 0 ? <p className={s.muted}>No open requests.</p> : null}
          <ul className={s.inboxList}>
            {pending.map((r) => (
              <li key={r.id} className={s.requestItem} data-testid={`request-${r.email}`}>
                <div className={s.personCell}>
                  <strong>{r.name} → {roleLabel(r.role)} in {appTitle(r.app)}</strong>
                  <span className={s.caption}>
                    {r.email} · asked by {r.requestedBy ?? 'someone'} · {timeAgo(r.createdAt)}
                  </span>
                  {r.note ? <span className={s.requestNote}>“{r.note}”</span> : null}
                </div>
                <div className={s.requestActions}>
                  <input
                    className={s.input}
                    aria-label={`Note for ${r.name}`}
                    placeholder="Note (optional)"
                    value={notes[r.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                  />
                  <button type="button" className={`${s.button} ${s.small}`} disabled={busy === r.id} onClick={() => void decide(r, true)}>
                    Approve
                  </button>
                  <button type="button" className={`${s.button} ${s.secondary} ${s.small}`} disabled={busy === r.id} onClick={() => void decide(r, false)}>
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {decided.length ? (
            <details className={s.decided}>
              <summary>Recent decisions ({decided.length})</summary>
              <ul className={s.inboxList}>
                {decided.map((r) => (
                  <li key={r.id} className={s.messageItem}>
                    <span className={r.status === 'approved' ? s.badge : `${s.badge} ${s.badgeNone}`}>{r.status === 'approved' ? 'Approved' : 'Declined'}</span>
                    <span>{r.name} → {roleLabel(r.role)} in {appTitle(r.app)}</span>
                    <span className={s.caption}>{r.decidedBy ? `by ${r.decidedBy} · ` : ''}{r.decidedAt ? timeAgo(r.decidedAt) : ''}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      <section className={s.panel} aria-labelledby="messages-h">
        <h2 id="messages-h" className={s.cardTitle}>
          {show === 'all' ? 'Messages' : SHOWS.find((f) => f.key === show)?.label}
        </h2>
        {items === null ? <p className={s.muted}>Loading…</p> : null}
        {items?.length === 0 ? <p className={s.muted}>Nothing yet.</p> : null}
        {items?.length && shown?.length === 0 ? <p className={s.muted}>Nothing here.</p> : null}
        <ul className={s.inboxList}>
          {shown?.map((m) => (
            <li key={m.id} className={`${s.messageItem} ${m.readAt ? '' : s.messageUnread}`}>
              {m.readAt ? null : <span className={s.unreadDot} aria-label="New" />}
              <div className={s.personCell}>
                <strong>{m.title}</strong>
                {m.body ? <span className={s.caption}>{m.body}</span> : null}
              </div>
              <span className={s.spacer} />
              <span className={s.caption}>{timeAgo(m.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
