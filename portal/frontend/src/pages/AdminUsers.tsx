import { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { api, APPS, ROLES, roleLabel, type AppError, type AppKey, type ChangeReport, type Grant, type SuiteUser } from '../api';
import { Icon } from '../components/Icon';
import { Banner, Dialog, fmtDate, RoleBadge } from '../components/ui';
import { useMe } from '../useMe';
import s from '../styles/portal.module.css';

type Team = { id: string; name: string };
type Draft = Record<AppKey, { role: string | null; leadTeamIds: string[] }>;

const emptyDraft = (): Draft => ({
  lms: { role: null, leadTeamIds: [] },
  expense: { role: null, leadTeamIds: [] },
  kanban: { role: null, leadTeamIds: [] },
  ams: { role: null, leadTeamIds: [] },
});

const STATUS_CLASS: Record<SuiteUser['status'], string> = {
  active: s.badge ?? '',
  invited: `${s.badge} ${s.badgeWarn}`,
  inactive: `${s.badge} ${s.badgeDanger}`,
};

function appErrors(errors: AppError[]): string | null {
  return errors.length ? errors.map((e) => e.detail).join(' ') : null;
}

/** Global admin: everyone in the suite, their role in each app, invite and change access. */
export function AdminUsers() {
  const { me } = useMe();
  const [users, setUsers] = useState<SuiteUser[]>([]);
  const [q, setQ] = useState('');
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<SuiteUser | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger' | 'warn'; text: string } | null>(null);

  const load = useCallback(async () => {
    const data = await api<{ items: SuiteUser[] }>(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    setUsers(data.items);
  }, [q]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  const report = (r: ChangeReport, ok: string) => {
    const failed = appErrors(r.errors);
    // Development mode records emails without sending them: say so instead of "on its way".
    const stub = r.mailDelivery === 'stub' && ok.includes('email');
    const text = stub ? `${ok.replace(' An invitation email is on its way.', '')} Email NOT sent: mail is in development mode (MAIL_PROVIDER=stub).` : ok;
    setNotice(failed ? { tone: 'warn', text: `${text} Some apps refused: ${failed}` } : { tone: stub ? 'warn' : 'ok', text });
    void load();
  };

  async function setStatus(u: SuiteUser, status: 'active' | 'inactive') {
    try {
      const r = await api<ChangeReport>(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      report(r, status === 'inactive' ? `${u.email} was deactivated and signed out of every app.` : `${u.email} was reactivated.`);
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    }
  }

  async function resend(u: SuiteUser) {
    try {
      await api(`/api/admin/users/${u.id}/resend-invite`, { method: 'POST' });
      setNotice({ tone: 'ok', text: `Invitation sent again to ${u.email}.` });
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    }
  }

  const actions = (u: SuiteUser) => (
    <div className={s.row}>
      {u.status !== 'inactive' ? (
        <button type="button" className={`${s.button} ${s.secondary} ${s.small}`} onClick={() => setEditing(u)}>Edit access</button>
      ) : null}
      {u.status === 'invited' ? (
        <button type="button" className={`${s.button} ${s.secondary} ${s.small}`} onClick={() => void resend(u)}>Resend invite</button>
      ) : null}
      {u.id !== me.id ? (
        u.status === 'inactive' ? (
          <button type="button" className={`${s.button} ${s.secondary} ${s.small}`} onClick={() => void setStatus(u, 'active')}>Reactivate</button>
        ) : (
          <button
            type="button"
            className={`${s.button} ${s.secondary} ${s.small}`}
            onClick={() => window.confirm(`Deactivate ${u.email}? They lose access to every app.`) && void setStatus(u, 'inactive')}
          >
            Deactivate
          </button>
        )
      ) : null}
    </div>
  );

  return (
    <div className={s.stack}>
      <div className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Users &amp; access</h1>
          <p className={s.lead}>Invite people by work email and choose their role in each app. App admins' changes show here too.</p>
        </div>
        <div className={s.row}>
          <NavLink to="/admin/audit" className={`${s.button} ${s.secondary}`}>
            <Icon name="history" size={18} /> Audit log
          </NavLink>
          <NavLink to="/admin/import" className={`${s.button} ${s.secondary}`} data-testid="import-open">
            <Icon name="upload" size={18} /> Import CSV
          </NavLink>
          <button type="button" className={s.button} onClick={() => setInviting(true)} data-testid="invite-open">
            <Icon name="plus" size={18} /> Invite user
          </button>
        </div>
      </div>
      {notice ? <Banner tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Banner> : null}
      <input className={s.input} type="search" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />

      <section className={s.panel}>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Person</th>
                <th>Status</th>
                {APPS.map((a) => <th key={a.key}>{a.short}</th>)}
                <th>Last sign-in</th>
                <th><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className={s.personCell}>
                      <strong>{u.name || u.email}</strong>
                      <span className={s.caption}>{u.email}{u.isGlobalAdmin ? ' · Global admin' : ''}</span>
                    </div>
                  </td>
                  <td><span className={STATUS_CLASS[u.status]}>{roleLabel(u.status)}</span></td>
                  {APPS.map((a) => <td key={a.key}><RoleBadge role={u.access[a.key]} /></td>)}
                  <td className={s.caption}>{fmtDate(u.lastLoginAt)}</td>
                  <td>{actions(u)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={s.listCards}>
          {users.map((u) => (
            <div key={u.id} className={s.listCard}>
              <div className={s.row}>
                <strong>{u.name || u.email}</strong>
                <span className={s.spacer} />
                <span className={STATUS_CLASS[u.status]}>{roleLabel(u.status)}</span>
              </div>
              <span className={s.caption}>{u.email}{u.isGlobalAdmin ? ' · Global admin' : ''}</span>
              <div className={s.row}>
                {APPS.map((a) => (
                  <span key={a.key} className={s.caption}>{a.short}: <RoleBadge role={u.access[a.key]} /></span>
                ))}
              </div>
              {actions(u)}
            </div>
          ))}
        </div>
        {users.length === 0 ? <p className={s.muted}>Nobody matches.</p> : null}
      </section>

      {inviting ? (
        <AccessDialog
          mode="invite"
          onClose={() => setInviting(false)}
          onDone={(r) => {
            setInviting(false);
            report(r, `${r.user.email} was invited. An invitation email is on its way.`);
          }}
        />
      ) : null}
      {editing ? (
        <AccessDialog
          mode="edit"
          user={editing}
          onClose={() => setEditing(null)}
          onDone={(r) => {
            setEditing(null);
            report(r, `Access for ${r.user.email} was updated in every app.`);
          }}
        />
      ) : null}
    </div>
  );
}

function AccessDialog({ mode, user, onClose, onDone }: { mode: 'invite' | 'edit'; user?: SuiteUser; onClose: () => void; onDone: (r: ChangeReport) => void }) {
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [globalAdmin, setGlobalAdmin] = useState(user?.isGlobalAdmin ?? false);
  const [draft, setDraft] = useState<Draft>(() => {
    const d = emptyDraft();
    if (user) for (const a of APPS) d[a.key].role = user.access[a.key];
    return d;
  });
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ name: string; email: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wantsTeams = draft.kanban.role === 'lead';
  useEffect(() => {
    if (wantsTeams && teams === null) {
      api<Team[]>('/api/admin/kanban-teams').then(setTeams).catch((e) => setTeamsError((e as Error).message));
    }
  }, [wantsTeams, teams]);

  useEffect(() => {
    if (mode !== 'invite' || email.length < 2 || email.includes('@')) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ items: { name: string; email: string }[] }>(`/api/admin/directory?q=${encodeURIComponent(email)}`)
        .then((d) => setSuggestions(d.items))
        .catch(() => setSuggestions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [email, mode]);

  const setRole = (app: AppKey, role: string | null) => setDraft({ ...draft, [app]: { ...draft[app], role } });
  const toggleTeam = (id: string) => {
    const has = draft.kanban.leadTeamIds.includes(id);
    setDraft({ ...draft, kanban: { ...draft.kanban, leadTeamIds: has ? draft.kanban.leadTeamIds.filter((t) => t !== id) : [...draft.kanban.leadTeamIds, id] } });
  };

  async function submit() {
    setBusy(true);
    setError(null);
    const access: Record<string, Grant> = {};
    for (const a of APPS) access[a.key] = { role: draft[a.key].role, leadTeamIds: a.key === 'kanban' ? draft.kanban.leadTeamIds : [] };
    try {
      if (mode === 'invite') {
        onDone(await api<ChangeReport>('/api/admin/users', { method: 'POST', body: JSON.stringify({ email, name, isGlobalAdmin: globalAdmin, access }) }));
      } else if (user) {
        let r = await api<ChangeReport>(`/api/admin/users/${user.id}/access`, { method: 'PUT', body: JSON.stringify(access) });
        if (globalAdmin !== user.isGlobalAdmin || (name && name !== user.name)) {
          const p = await api<ChangeReport>(`/api/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ isGlobalAdmin: globalAdmin, name }) });
          r = { user: p.user, errors: r.errors };
        }
        onDone(r);
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={mode === 'invite' ? 'Invite user' : `Edit access: ${user?.email}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={`${s.button} ${s.secondary}`} onClick={onClose}>Cancel</button>
          <button type="button" className={s.button} disabled={busy || (mode === 'invite' && !email.includes('@'))} onClick={() => void submit()} data-testid="access-save">
            {mode === 'invite' ? 'Send invitation' : 'Save access'}
          </button>
        </>
      }
    >
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <div className={s.formGrid}>
        {mode === 'invite' ? (
          <label className={s.field}>
            <span className={s.fieldLabel}>Work email</span>
            <input className={s.input} type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@tektalis.com or search by name" data-testid="invite-email" />
          </label>
        ) : null}
        {suggestions.length ? (
          <div className={s.suggestions} role="listbox" aria-label="Directory matches">
            {suggestions.map((p) => (
              <button key={p.email} type="button" role="option" aria-selected="false" className={s.suggestion} onClick={() => { setEmail(p.email); setName(p.name); setSuggestions([]); }}>
                <span>{p.name}</span>
                <span className={s.caption}>{p.email}</span>
              </button>
            ))}
          </div>
        ) : null}
        <label className={s.field}>
          <span className={s.fieldLabel}>Name</span>
          <input className={s.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Filled from Microsoft on first sign-in" />
        </label>
        <div className={s.accessGrid}>
          {APPS.map((a) => (
            <AppRole key={a.key} app={a.key} label={a.title} role={draft[a.key].role} onChange={(r) => setRole(a.key, r)} />
          ))}
          {wantsTeams ? (
            <div className={s.teams} role="group" aria-label="Kanban teams this person leads">
              {teamsError ? <span className={s.caption}>{teamsError}</span> : null}
              {teams === null && !teamsError ? <span className={s.caption}>Loading teams…</span> : null}
              {teams?.map((t) => (
                <label key={t.id} className={s.check}>
                  <input type="checkbox" checked={draft.kanban.leadTeamIds.includes(t.id)} onChange={() => toggleTeam(t.id)} />
                  {t.name}
                </label>
              ))}
              {teams && teams.length === 0 ? <span className={s.caption}>Kanban has no teams yet.</span> : null}
            </div>
          ) : null}
        </div>
        <label className={s.check}>
          <input type="checkbox" checked={globalAdmin} onChange={(e) => setGlobalAdmin(e.target.checked)} />
          Global admin (can invite people and manage access to every app)
        </label>
      </div>
    </Dialog>
  );
}

function AppRole({ app, label, role, onChange }: { app: AppKey; label: string; role: string | null; onChange: (r: string | null) => void }) {
  const id = `role-${app}`;
  return (
    <>
      <label htmlFor={id} className={s.fieldLabel}>{label}</label>
      <select id={id} className={s.select} value={role ?? ''} onChange={(e) => onChange(e.target.value || null)} data-testid={id}>
        <option value="">No access</option>
        {ROLES[app].map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
      </select>
    </>
  );
}
