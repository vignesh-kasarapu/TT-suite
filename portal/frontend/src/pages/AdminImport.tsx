import { Fragment, useEffect, useMemo, useState, type DragEvent } from 'react';
import { NavLink } from 'react-router';
import { api, APPS, ROLES, roleLabel, type AppError, type AppKey, type SuiteUser } from '../api';
import { parseCsv } from '../csv';
import { Icon } from '../components/Icon';
import { Banner } from '../components/ui';
import s from '../styles/portal.module.css';

type Team = { id: string; name: string };
type Tone = 'ok' | 'warn' | 'danger';
type Row = {
  key: number; // position in the file
  email: string;
  name: string;
  employeeCode: string;
  roles: Record<AppKey, string | null>;
  teamId: string; // the team a Kanban lead leads
  teamName: string; // from the file, matched to a team once the teams load
  globalAdmin: boolean;
  selected: boolean;
  notes: string[];
  result?: { tone: Tone; text: string };
};
type BulkResult = { email: string; ok: boolean; user?: SuiteUser; errors?: AppError[]; code?: string; detail?: string };
type Check = { blocked: boolean; tone: Tone; text: string };

const MAX_ROWS = 1000;
const CHUNK = 100;
const KEEP = '__keep';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEADERS: Record<string, string[]> = {
  email: ['email', 'work email', 'mail'],
  name: ['name', 'full name', 'display name'],
  employeeCode: ['employee code', 'employee id', 'emp code', 'emp id', 'code'],
  lms: ['lms', 'leave'],
  expense: ['ems', 'expense'],
  kanban: ['kanban'],
  ams: ['ams', 'assets', 'asset management'],
  resume: ['resume', 'resumes', 'resume evaluator'],
  team: ['kanban team', 'team'],
  globalAdmin: ['global admin'],
};
const TEMPLATE = [
  'email,name,employee_code,lms,ems,kanban,kanban_team,ams,resume,global_admin',
  'jane.doe@tektalis.com,Jane Doe,TT1001,employee,member,member,,employee,,no',
  'raj.kumar@tektalis.com,Raj Kumar,TT1002,manager,approver,lead,Platform,manager,recruiter,no',
].join('\r\n');

const header = (h: string) => h.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
const shortName = (app: AppKey) => APPS.find((a) => a.key === app)?.short ?? app;

function parseRole(app: AppKey, raw: string, notes: string[]): string | null {
  const v = raw.toLowerCase();
  if (!v || v === 'none' || v === 'no access' || v === '-') return null;
  if (ROLES[app].includes(v)) return v;
  notes.push(`"${raw}" is not a ${shortName(app)} role, so ${shortName(app)} was left as No access.`);
  return null;
}

function toRows(text: string): { rows: Row[]; error: string | null } {
  const [head, ...body] = parseCsv(text);
  if (!head) return { rows: [], error: 'The file is empty.' };
  const col: Record<string, number> = {};
  head.forEach((h, i) => {
    for (const [k, names] of Object.entries(HEADERS)) if (col[k] === undefined && names.includes(header(h))) col[k] = i;
  });
  if (col.email === undefined) return { rows: [], error: 'The file needs an "email" column. Download the template to see the format.' };
  if (body.length === 0) return { rows: [], error: 'The file has a header but nobody in it.' };
  if (body.length > MAX_ROWS) return { rows: [], error: `The file lists ${body.length} people. Import at most ${MAX_ROWS} at a time.` };
  const cell = (r: string[], k: string) => {
    const i = col[k];
    return i === undefined ? '' : (r[i] ?? '').trim();
  };
  const rows = body.map((r, key): Row => {
    const notes: string[] = [];
    return {
      key,
      email: cell(r, 'email').toLowerCase(),
      name: cell(r, 'name'),
      employeeCode: cell(r, 'employeeCode'),
      roles: { lms: parseRole('lms', cell(r, 'lms'), notes), expense: parseRole('expense', cell(r, 'expense'), notes), kanban: parseRole('kanban', cell(r, 'kanban'), notes), ams: parseRole('ams', cell(r, 'ams'), notes), resume: parseRole('resume', cell(r, 'resume'), notes) },
      teamId: '',
      teamName: cell(r, 'team'),
      globalAdmin: /^(y|yes|true|1)$/i.test(cell(r, 'globalAdmin')),
      selected: true,
      notes,
    };
  });
  return { rows, error: null };
}

function describe(r: BulkResult): { tone: Tone; text: string } {
  if (!r.ok) return { tone: 'danger', text: r.detail || 'Not invited.' };
  if (r.errors?.length) return { tone: 'warn', text: `Invited, but ${r.errors.map((e) => e.detail).join(' ')}` };
  return { tone: 'ok', text: 'Invited' };
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'suite-invites-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/** Global admin: invite many people from a CSV file, reviewing each row's access first. */
export function AdminImport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState('');
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [bar, setBar] = useState<Record<AppKey, string>>({ lms: KEEP, expense: KEEP, kanban: KEEP, ams: KEEP, resume: KEEP });
  const [barTeam, setBarTeam] = useState('');
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null);

  useEffect(() => {
    api<{ items: SuiteUser[] }>('/api/admin/users')
      .then((d) => setExisting(new Set(d.items.map((u) => u.email))))
      .catch((e) => setNotice({ tone: 'danger', text: (e as Error).message }));
  }, []);

  const needTeams = bar.kanban === 'lead' || rows.some((r) => r.roles.kanban === 'lead' || r.teamName);
  useEffect(() => {
    if (needTeams && teams === null && !teamsError) {
      api<Team[]>('/api/admin/kanban-teams').then(setTeams).catch((e) => setTeamsError((e as Error).message));
    }
  }, [needTeams, teams, teamsError]);

  // Match the file's team names once the teams are known (each row once).
  useEffect(() => {
    if (!teams || !rows.some((r) => r.teamName)) return;
    const byName = new Map(teams.map((t) => [t.name.trim().toLowerCase(), t.id]));
    setRows((prev) =>
      prev.map((r) => {
        if (!r.teamName) return r;
        const id = byName.get(r.teamName.toLowerCase());
        const notes = id || r.roles.kanban !== 'lead' ? r.notes : [...r.notes, `Kanban has no team named "${r.teamName}".`];
        return { ...r, teamId: id ?? r.teamId, teamName: '', notes };
      }),
    );
  }, [teams, rows]);

  const checks = useMemo(() => {
    const first = new Map<string, number>();
    for (const r of rows) if (!first.has(r.email)) first.set(r.email, r.key);
    const codeFirst = new Map<string, number>();
    for (const r of rows) {
      const c = r.employeeCode.trim().toLowerCase();
      if (c && !codeFirst.has(c)) codeFirst.set(c, r.key);
    }
    return new Map(
      rows.map((r): [number, Check] => {
        if (r.result && r.result.tone !== 'danger') return [r.key, { blocked: true, ...r.result }];
        if (!EMAIL_RE.test(r.email)) return [r.key, { blocked: true, tone: 'danger', text: r.email ? 'Not a valid email' : 'No email' }];
        if (existing.has(r.email)) return [r.key, { blocked: true, tone: 'warn', text: 'Already in the suite' }];
        if (first.get(r.email) !== r.key) return [r.key, { blocked: true, tone: 'warn', text: 'Listed twice in the file' }];
        if (r.result) return [r.key, { blocked: false, ...r.result }];
        if (!r.employeeCode.trim()) return [r.key, { blocked: false, tone: 'warn', text: 'Enter the employee code' }];
        if (codeFirst.get(r.employeeCode.trim().toLowerCase()) !== r.key) return [r.key, { blocked: false, tone: 'warn', text: 'Employee code listed twice' }];
        if (r.roles.kanban === 'lead' && !r.teamId) return [r.key, { blocked: false, tone: 'warn', text: 'Pick a Kanban team' }];
        return [r.key, { blocked: false, tone: 'ok', text: 'Ready' }];
      }),
    );
  }, [rows, existing]);

  const check = (r: Row): Check => checks.get(r.key) ?? { blocked: true, tone: 'danger', text: '' };
  const open = rows.filter((r) => !check(r).blocked);
  const sendable = open.filter((r) => r.selected && !(r.roles.kanban === 'lead' && !r.teamId));
  const needsFix = open.filter((r) => r.selected).length - sendable.length;
  const allSelected = open.length > 0 && open.every((r) => r.selected);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch, result: r.result?.tone === 'danger' ? undefined : r.result } : r)));
  const setRole = (r: Row, app: AppKey, role: string | null) => update(r.key, { roles: { ...r.roles, [app]: role } });

  async function load(file: File) {
    setNotice(null);
    const { rows: parsed, error } = toRows(await file.text());
    if (error) {
      setNotice({ tone: 'danger', text: error });
      return;
    }
    setFileName(file.name);
    setRows(parsed);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void load(file);
  }

  function applyToSelected() {
    setRows((prev) =>
      prev.map((r) => {
        if (!r.selected || check(r).blocked) return r;
        const roles = { ...r.roles };
        for (const a of APPS) if (bar[a.key] !== KEEP) roles[a.key] = bar[a.key] || null;
        return { ...r, roles, teamId: roles.kanban === 'lead' && barTeam ? barTeam : r.teamId };
      }),
    );
  }

  async function send() {
    const batch = sendable;
    let invited = 0;
    let failed = 0;
    let delivery = '';
    setNotice(null);
    try {
      for (let i = 0; i < batch.length; i += CHUNK) {
        const part = batch.slice(i, i + CHUNK);
        setProgress(`Sending ${Math.min(i + CHUNK, batch.length)} of ${batch.length}…`);
        const people = part.map((r) => ({
          email: r.email,
          name: r.name,
          employeeCode: r.employeeCode.trim(),
          isGlobalAdmin: r.globalAdmin,
          access: Object.fromEntries(
            APPS.map((a) => [a.key, { role: r.roles[a.key], leadTeamIds: a.key === 'kanban' && r.roles.kanban === 'lead' ? [r.teamId] : [] }]),
          ),
        }));
        const res = await api<{ results: BulkResult[]; mailDelivery: string }>('/api/admin/users/bulk', { method: 'POST', body: JSON.stringify({ people }) });
        delivery = res.mailDelivery;
        const byKey = new Map(part.map((r, j) => [r.key, res.results[j]]));
        invited += res.results.filter((out) => out.ok).length;
        failed += res.results.filter((out) => !out.ok).length;
        setRows((prev) => prev.map((r) => {
          const out = byKey.get(r.key);
          return out ? { ...r, result: describe(out) } : r;
        }));
      }
      const stub = delivery === 'stub' && invited ? ' Emails were NOT sent: mail is in development mode (MAIL_PROVIDER=stub).' : '';
      const text = `${invited} ${invited === 1 ? 'person was' : 'people were'} invited.${failed ? ` ${failed} could not be invited; see the Status column.` : ''}${stub}`;
      setNotice({ tone: failed || stub ? 'warn' : 'ok', text });
    } catch (e) {
      setNotice({ tone: 'danger', text: `${(e as Error).message}${invited ? ` ${invited} people were invited before this.` : ''}` });
    } finally {
      setProgress(null);
    }
  }

  const statusBadge = (r: Row) => {
    const c = check(r);
    const cls = c.tone === 'ok' ? s.badge : c.tone === 'warn' ? `${s.badge} ${s.badgeWarn}` : `${s.badge} ${s.badgeDanger}`;
    const long = c.text.length > 28;
    return (
      <div className={`${s.personCell} ${s.importStatus}`}>
        <span className={cls}>{long ? (c.tone === 'danger' ? 'Not invited' : 'Invited') : c.text}</span>
        {long ? <span className={s.caption}>{c.text}</span> : null}
        {r.notes.map((n) => <span key={n} className={s.caption}>{n}</span>)}
      </div>
    );
  };

  const roleSelect = (r: Row, app: AppKey, label: string) => (
    <select className={s.select} aria-label={label} value={r.roles[app] ?? ''} disabled={check(r).blocked || !!progress} onChange={(e) => setRole(r, app, e.target.value || null)}>
      <option value="">No access</option>
      {ROLES[app].map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
    </select>
  );

  const teamSelect = (r: Row) =>
    r.roles.kanban === 'lead' ? (
      <select className={s.select} aria-label={`Kanban team for ${r.email}`} value={r.teamId} disabled={check(r).blocked || !!progress} onChange={(e) => update(r.key, { teamId: e.target.value })}>
        <option value="">{teams ? 'Pick a team' : teamsError ? 'Teams unavailable' : 'Loading teams…'}</option>
        {teams?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    ) : null;

  const selectBox = (r: Row) => (
    <input type="checkbox" aria-label={`Invite ${r.email}`} checked={r.selected && !check(r).blocked} disabled={check(r).blocked || !!progress} onChange={(e) => update(r.key, { selected: e.target.checked })} />
  );

  return (
    <div className={s.stack}>
      <div className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Import people from CSV</h1>
          <p className={s.lead}>Check each person's access, pick who to invite, then send. Everyone gets one invitation email.</p>
        </div>
        <div className={s.row}>
          <NavLink to="/admin" end className={`${s.button} ${s.secondary}`}>Back to users</NavLink>
          <button type="button" className={`${s.button} ${s.secondary}`} onClick={downloadTemplate}>
            <Icon name="download" size={18} /> Download template
          </button>
        </div>
      </div>
      {notice ? <Banner tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Banner> : null}

      {rows.length === 0 ? (
        <section
          className={`${s.panel} ${s.dropzone} ${dragging ? s.dropzoneActive : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Icon name="upload" size={32} />
          <p>Drop a CSV file here, or</p>
          <label className={s.button}>
            Choose CSV file
            <input type="file" accept=".csv,text/csv" className="visually-hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ''; }} data-testid="import-file" />
          </label>
          <p className={s.caption}>
            Columns: <strong>email</strong> and <strong>employee_code</strong> (required), name, lms, ems, kanban, kanban_team, ams, resume, global_admin.
            Roles: LMS {ROLES.lms.join(', ')}; EMS {ROLES.expense.join(', ')}; Kanban {ROLES.kanban.join(', ')}; AMS {ROLES.ams.join(', ')}; Resume Evaluator {ROLES.resume.join(', ')}. Leave a cell empty for no access.
          </p>
        </section>
      ) : (
        <section className={`${s.panel} ${s.stack}`}>
          <div className={s.row}>
            <strong>{fileName}</strong>
            <span className={s.caption}>{rows.length} {rows.length === 1 ? 'row' : 'rows'}, {open.length} can be invited</span>
            <span className={s.spacer} />
            <button type="button" className={`${s.button} ${s.secondary} ${s.small}`} disabled={!!progress} onClick={() => { setRows([]); setFileName(''); setNotice(null); }}>
              Choose another file
            </button>
          </div>

          <div className={s.applyBar} role="group" aria-label="Set access for the selected rows">
            {APPS.map((a) => (
              <label key={a.key} className={s.field}>
                <span className={s.caption}>{a.short}</span>
                <select className={s.select} value={bar[a.key]} onChange={(e) => setBar({ ...bar, [a.key]: e.target.value })}>
                  <option value={KEEP}>Leave as is</option>
                  <option value="">No access</option>
                  {ROLES[a.key].map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                </select>
              </label>
            ))}
            {bar.kanban === 'lead' ? (
              <label className={s.field}>
                <span className={s.caption}>Kanban team</span>
                <select className={s.select} value={barTeam} onChange={(e) => setBarTeam(e.target.value)}>
                  <option value="">Pick a team</option>
                  {teams?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            ) : null}
            <button type="button" className={`${s.button} ${s.secondary}`} disabled={!!progress || !open.some((r) => r.selected)} onClick={applyToSelected}>
              Apply to selected
            </button>
          </div>
          {teamsError ? <Banner tone="warn">Kanban teams could not be loaded: {teamsError}</Banner> : null}

          <div className={`${s.tableWrap} ${s.importScroll}`}>
            <table className={`${s.table} ${s.importTable}`}>
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" aria-label="Select everyone who can be invited" checked={allSelected} disabled={!open.length || !!progress}
                      onChange={(e) => setRows((prev) => prev.map((r) => (check(r).blocked ? r : { ...r, selected: e.target.checked })))} />
                  </th>
                  <th>Person</th>
                  {APPS.map((a) => <th key={a.key}>{a.short}</th>)}
                  <th>Global admin</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={check(r).blocked ? s.rowBlocked : undefined}>
                    <td>{selectBox(r)}</td>
                    <td>
                      <div className={s.personCell}>
                        <strong>{r.email || '—'}</strong>
                        <input className={s.input} aria-label={`Name for ${r.email}`} placeholder="Name (optional)" value={r.name} disabled={check(r).blocked || !!progress}
                          onChange={(e) => update(r.key, { name: e.target.value })} />
                        <input className={s.input} aria-label={`Employee code for ${r.email}`} placeholder="Employee code (required)" value={r.employeeCode}
                          maxLength={40} disabled={check(r).blocked || !!progress} onChange={(e) => update(r.key, { employeeCode: e.target.value })} />
                      </div>
                    </td>
                    <td>{roleSelect(r, 'lms', `LMS role for ${r.email}`)}</td>
                    <td>{roleSelect(r, 'expense', `EMS role for ${r.email}`)}</td>
                    <td>
                      <div className={s.personCell}>
                        {roleSelect(r, 'kanban', `Kanban role for ${r.email}`)}
                        {teamSelect(r)}
                      </div>
                    </td>
                    <td>{roleSelect(r, 'ams', `AMS role for ${r.email}`)}</td>
                    <td>{roleSelect(r, 'resume', `Resume Evaluator role for ${r.email}`)}</td>
                    <td>
                      <input type="checkbox" aria-label={`Global admin: ${r.email}`} checked={r.globalAdmin} disabled={check(r).blocked || !!progress}
                        onChange={(e) => update(r.key, { globalAdmin: e.target.checked })} />
                    </td>
                    <td>{statusBadge(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={s.listCards}>
            {rows.map((r) => (
              <div key={r.key} className={`${s.listCard} ${check(r).blocked ? s.rowBlocked : ''}`}>
                <label className={s.check}>
                  {selectBox(r)}
                  <strong>{r.email || '—'}</strong>
                </label>
                <input className={s.input} aria-label={`Name for ${r.email}`} placeholder="Name (optional)" value={r.name} disabled={check(r).blocked || !!progress}
                  onChange={(e) => update(r.key, { name: e.target.value })} />
                <div className={s.accessGrid}>
                  {APPS.map((a) => (
                    <Fragment key={a.key}>
                      <span className={s.fieldLabel}>{a.short}</span>
                      {roleSelect(r, a.key, `${a.short} role for ${r.email}`)}
                    </Fragment>
                  ))}
                  {r.roles.kanban === 'lead' ? (<><span className={s.fieldLabel}>Team</span>{teamSelect(r)}</>) : null}
                </div>
                <label className={s.check}>
                  <input type="checkbox" checked={r.globalAdmin} disabled={check(r).blocked || !!progress} onChange={(e) => update(r.key, { globalAdmin: e.target.checked })} />
                  Global admin
                </label>
                {statusBadge(r)}
              </div>
            ))}
          </div>

          <div className={s.importFoot}>
            {needsFix ? <span className={s.caption}>{needsFix} selected {needsFix === 1 ? 'lead needs' : 'leads need'} a Kanban team first.</span> : null}
            {progress ? <span className={s.caption} role="status">{progress}</span> : null}
            <button type="button" className={s.button} disabled={!sendable.length || !!progress} onClick={() => void send()} data-testid="import-send">
              <Icon name="mail" size={18} /> {sendable.length ? `Send ${sendable.length} ${sendable.length === 1 ? 'invitation' : 'invitations'}` : 'Send invitations'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
