import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { api, APPS, roleLabel } from '../api';
import { fmtDate } from '../components/ui';
import s from '../styles/portal.module.css';

type Entry = { id: number; at: string; action: string; app: string | null; detail: Record<string, unknown>; actor: string | null; target: string | null };

const ACTIONS: Record<string, string> = {
  invited: 'Invited',
  access_changed: 'Access changed',
  person_updated: 'Person updated',
  invite_resent: 'Invitation resent',
  sign_in: 'Signed in',
  app_launch: 'Opened app',
  app_launch_denied: 'Denied app',
  access_requested: 'Requested access',
};

function describe(e: Entry): string {
  if (e.action === 'access_changed') {
    const d = e.detail as { from?: string | null; to?: string | null; source?: string };
    return `${roleLabel(d.from)} → ${roleLabel(d.to)} (${d.source === 'app' ? 'by the app admin' : 'by the global admin'})`;
  }
  if (e.action === 'app_launch') return `as ${roleLabel((e.detail as { role?: string }).role)}`;
  return '';
}

export function AdminAudit() {
  const [items, setItems] = useState<Entry[]>([]);
  useEffect(() => {
    void api<{ items: Entry[] }>('/api/admin/audit?limit=200').then((d) => setItems(d.items));
  }, []);
  const appTitle = (k: string | null) => APPS.find((a) => a.key === k)?.short ?? '';
  return (
    <div className={s.stack}>
      <div className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Audit log</h1>
          <p className={s.lead}>Every access change, from the global admin or from an app admin.</p>
        </div>
        <NavLink to="/admin" className={`${s.button} ${s.secondary}`}>Back to users</NavLink>
      </div>
      <section className={s.panel}>
        <table className={s.table}>
          <thead>
            <tr><th>When</th><th>What</th><th>App</th><th>Who</th><th>Person</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td className={s.caption}>{fmtDate(e.at)}</td>
                <td>{ACTIONS[e.action] ?? e.action}</td>
                <td>{appTitle(e.app)}</td>
                <td>{e.actor ?? '—'}</td>
                <td>{e.target ?? '—'}</td>
                <td className={s.caption}>{describe(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 ? <p className={s.muted}>Nothing recorded yet.</p> : null}
      </section>
    </div>
  );
}
