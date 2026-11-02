import { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { activeApps, api, ROLES, roleLabel, type AppError, type AppKey, type ChangeReport, type Grant, type SuiteUser } from '../api';
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
  resume: { role: null, leadTeamIds: [] },
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
  const apps = activeApps(me);
  const [users, setUsers] = useState<SuiteUser[]>([]);
  const [q, setQ] = useState('');
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<SuiteUser | null>(null);
  const [details, setDetails] = useState<SuiteUser | null>(null);
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

  // Resend invite: one click = one email. The button is disabled while sending and for a minute
  // after (the server refuses a second one within a minute too), and says what happened.
  const [resending, setResending] = useState<Record<string, 'sending' | 'sent'>>({});
  async function resend(u: SuiteUser) {
    if (resending[u.id]) return;
    setResending((r) => ({ ...r, [u.id]: 'sending' }));
    try {
      const r = await api<{ mailDelivery?: string }>(`/api/admin/users/${u.id}/resend-invite`, { method: 'POST' });
      setResending((x) => ({ ...x, [u.id]: 'sent' }));
      setNotice(r?.mailDelivery === 'stub'
        ? { tone: 'warn', text: `Invitation for ${u.email} recorded, NOT sent: mail is in development mode (MAIL_PROVIDER=stub).` }
        : { tone: 'ok', text: `Invitation email sent again to ${u.email}. It can take a minute to arrive (check Junk too).` });
      setTimeout(() => setResending((x) => {
        const { [u.id]: _done, ...rest } = x;
        return rest;
      }), 60_000);
    } catch (e) {
      setResending((x) => {
        const { [u.id]: _failed, ...rest } = x;
        return rest;
      });
      setNotice({ tone: 'danger', text: (e as Error).message });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' }); // the notice is at the top of the page
  }

  const actions = (u: SuiteUser) => (
    <div className={s.row}>
      {u.status !== 'inactive' ? (
        <button type="button" className={`${s.button} ${s.secondary} ${s.small}`} onClick={() => setEditing(u)}>Edit access</button>
      ) : null}
      <button type="button" className={`${s.button} ${s.secondary} ${s.small}`} onClick={() => setDetails(u)} data-testid="details-open">Edit details</button>
      {u.status === 'invited' ? (
        <button type="button" className={`${s.button} ${s.secondary} ${s.small}`} onClick={() => void resend(u)}
          disabled={!!resending[u.id]} aria-busy={resending[u.id] === 'sending'} data-testid="resend-invite">
          {resending[u.id] === 'sending' ? 'Sending…' : resending[u.id] === 'sent' ? 'Sent ✓' : 'Resend invite'}
        </button>
      ) : null}
      {u.id !== me.id ? (
        u.status === 'inactive' ? (
          <button type="button" className={`${s.button} ${s.secondary} ${s.small}`} onClick={() => void setStatus(u, 'active')}>Reactivate</button>
        ) : (
          <button
            type="button"
            className={`${s.button} ${s.secondary} ${s.small}`}
            onClick={() => window.confirm(`Deactivate ${u.email}? They are signed out everywhere and can no longer open any app.`) && void setStatus(u, 'inactive')}
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
                {apps.map((a) => <th key={a.key}>{a.short}</th>)}
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
                      <span className={s.caption} data-testid="employee-code">
                        {u.employeeCode ? `Employee code ${u.employeeCode}` : 'No employee code yet'}
                      </span>
                    </div>
                  </td>
                  <td><span className={STATUS_CLASS[u.status]}>{roleLabel(u.status)}</span></td>
                  {apps.map((a) => <td key={a.key}><RoleBadge role={u.access[a.key]} /></td>)}
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
              <span className={s.caption}>{u.employeeCode ? `Employee code ${u.employeeCode}` : 'No employee code yet'}</span>
              <div className={s.row}>
                {apps.map((a) => (
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
      {details ? (
        <DetailsDialog
          user={details}
          onClose={() => setDetails(null)}
          onDone={(r) => {
            setDetails(null);
            report(r, `Details for ${r.user.name || r.user.email} were saved and sent to every app.`);
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
  const apps = activeApps(useMe().me);
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [employeeCode, setEmployeeCode] = useState(user?.employeeCode ?? '');
  const [globalAdmin, setGlobalAdmin] = useState(user?.isGlobalAdmin ?? false);
  const [draft, setDraft] = useState<Draft>(() => {
    const d = emptyDraft();
    if (user) for (const a of apps) d[a.key].role = user.access[a.key];
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
    for (const a of apps) access[a.key] = { role: draft[a.key].role, leadTeamIds: a.key === 'kanban' ? draft.kanban.leadTeamIds : [] };
    try {
      if (mode === 'invite') {
        onDone(await api<ChangeReport>('/api/admin/users', { method: 'POST', body: JSON.stringify({ email, name, employeeCode, isGlobalAdmin: globalAdmin, access }) }));
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
          <button type="button" className={s.button} disabled={busy || (mode === 'invite' && (!email.includes('@') || !employeeCode.trim()))} onClick={() => void submit()} data-testid="access-save">
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
        {mode === 'invite' ? (
          <label className={s.field}>
            <span className={s.fieldLabel}>Employee code</span>
            <input className={s.input} required autoComplete="off" maxLength={40} value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)} placeholder="e.g. TT1042" data-testid="invite-employee-code" />
          </label>
        ) : null}
        <div className={s.accessGrid}>
          {apps.map((a) => (
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

type PersonDetails = {
  name: string; email: string; employeeCode: string | null; jobTitle: string | null;
  phone: string | null; location: string | null; personalEmail: string | null;
  dateOfBirth: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null;
  gender: string | null; maritalStatus: string | null;
};

const GENDERS = ['', 'MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] as const;
const MARITAL_STATUSES = ['', 'SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'] as const;
const codeLabel = (value: string) => (value ? value.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : 'Not set');

/** The global admin edits a person's details. The suite owns them, so every app picks the
 * change up on that person's next request — the same route as their own Profile edit. */
function DetailsDialog({ user, onClose, onDone }: { user: SuiteUser; onClose: () => void; onDone: (r: ChangeReport) => void }) {
  const [form, setForm] = useState<PersonDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PersonDetails>(`/api/admin/users/${user.id}/details`).then(setForm).catch((e) => setError((e as Error).message));
  }, [user.id]);

  const field = (key: keyof PersonDetails, label: string, extra: Record<string, unknown> = {}) => (
    <label className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <input className={s.input} value={form?.[key] ?? ''} disabled={!form}
        onChange={(e) => form && setForm({ ...form, [key]: e.target.value })} data-testid={`details-${key}`} {...extra} />
    </label>
  );

  const select = (key: keyof PersonDetails, label: string, options: readonly string[]) => (
    <label className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <select className={s.input} value={form?.[key] ?? ''} disabled={!form}
        onChange={(e) => form && setForm({ ...form, [key]: e.target.value })} data-testid={`details-${key}`}>
        {options.map((o) => <option key={o} value={o}>{codeLabel(o)}</option>)}
      </select>
    </label>
  );

  async function save() {
    if (!form) return;
    if (form.email.trim().toLowerCase() !== user.email &&
        !window.confirm(`Change the work email to ${form.email.trim()}? They will sign in with Microsoft using the new address.`)) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await api<ChangeReport>(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name, email: form.email, employeeCode: form.employeeCode ?? '',
          jobTitle: form.jobTitle ?? '', phone: form.phone ?? '', location: form.location ?? '',
          personalEmail: form.personalEmail ?? '', dateOfBirth: form.dateOfBirth ?? '',
          emergencyContactName: form.emergencyContactName ?? '',
          emergencyContactPhone: form.emergencyContactPhone ?? '',
          gender: form.gender ?? '', maritalStatus: form.maritalStatus ?? '',
        }),
      }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={`Edit details: ${user.name || user.email}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={`${s.button} ${s.secondary}`} onClick={onClose}>Cancel</button>
          <button type="button" className={s.button} disabled={busy || !form || !form.employeeCode?.trim() || !form.email.includes('@')}
            onClick={() => void save()} data-testid="details-save">
            Save details
          </button>
        </>
      }
    >
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <div className={s.formGrid}>
        {field('name', 'Name')}
        {field('employeeCode', 'Employee code', { maxLength: 40, required: true })}
        {field('email', 'Work email', { type: 'email', required: true })}
        {field('jobTitle', 'Job title', { maxLength: 120 })}
        {field('phone', 'Phone', { type: 'tel', maxLength: 40 })}
        {field('location', 'Location', { maxLength: 120 })}
        {field('personalEmail', 'Personal email', { type: 'email', maxLength: 255 })}
        {field('dateOfBirth', 'Date of birth', { type: 'date', max: new Date().toISOString().slice(0, 10) })}
        {select('gender', 'Gender', GENDERS)}
        {select('maritalStatus', 'Marital status', MARITAL_STATUSES)}
        {field('emergencyContactName', 'Emergency contact', { maxLength: 120 })}
        {field('emergencyContactPhone', 'Emergency contact phone', { type: 'tel', maxLength: 40 })}
        <p className={s.caption}>
          To stop someone using the suite, use Deactivate on the list: they are signed out everywhere and every app refuses them.
        </p>
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
