// Administration (FR-020..022, FR-004, FR-072, D-050, D-053): teams + membership, programs,
// projects, users. Every rule is the server's; forms show its field errors and codes.
// A team lead (CR-11) reaches the same page with only Teams and Projects, scoped to their teams.
import { useRef, useState, type FormEvent } from 'react';
import { Link, Outlet, useParams } from 'react-router';
import { Alert, Button, ConfirmDialog, Pill, Skeleton, TabLinks } from '../../components';
import { Icon } from '../../components/Icon';
import { t } from '../../i18n/t';
import { fieldErrorsOf, problemBanner, type Problem } from '../../api/client';
import { cx } from '../../styles/cx';
import { pageTitleClass } from '../Shell';
import { PermissionDenied } from '../pages';
import { useContextData } from '../auth/useMe';
import { useBoard, useSearch, type Card } from '../cards/api';
import c from '../cards/cards.module.css';
import o from '../org/org.module.css';
import { OrgHistory } from '../org/pages';
import { useLoginIssues } from './LoginIssues';
import {
  usePrograms,
  useProgramMutations,
  useProjectMutations,
  useProjects,
  useAllUsers,
  useRequestRoleChange,
  useRoleRequests,
  useTagMutations,
  useTags,
  useTeam,
  useTeamMutations,
  useTeams,
  useUsers,
  type Program,
  type Project,
  type Tag,
  type Team,
  type UserRef,
} from '../org/api';

export function AdminPage() {
  // Child tabs read the signed-in user (AdminUsers hides the self row's role button).
  const me = useContextData();
  const isAdmin = me.user.role === 'admin';
  // D-144: the Login issues tab shows how many are still open.
  const openIssues = useLoginIssues(isAdmin).data?.open ?? 0;
  return (
    <div className={c.page} data-testid="admin-page">
      <h1 className={pageTitleClass}>{t('admin.title')}</h1>
      <TabLinks
        label={t('admin.tabs')}
        tabs={[
          { to: '/admin', label: t('admin.teams'), end: true },
          ...(isAdmin ? [{ to: '/admin/programs', label: t('admin.programs') }] : []),
          { to: '/admin/projects', label: t('admin.projects') },
          ...(isAdmin
            ? [
                { to: '/admin/tags', label: t('admin.tags') },
                { to: '/admin/users', label: t('admin.users') },
                { to: '/admin/mail-templates', label: t('admin.mailTemplates') },
                {
                  to: '/admin/login-issues',
                  label: openIssues
                    ? t('admin.loginIssuesOpen', { count: openIssues })
                    : t('admin.loginIssues'),
                },
              ]
            : []),
        ]}
      />
      <Outlet context={me} />
    </div>
  );
}

function useRun() {
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  // CR-26: a DATE_CONFLICT is a question for the user, not an error - its program date.
  const [conflict, setConflict] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setFields({});
    setConflict(null);
    try {
      await fn();
      return true;
    } catch (p) {
      const problem = p as Problem;
      if (problem.code === 'DATE_CONFLICT') setConflict(problem.errors?.[0]?.message ?? '');
      else {
        setError(problemBanner(problem));
        setFields(fieldErrorsOf(problem));
      }
      return false;
    }
  }
  return {
    error,
    fields,
    run,
    conflict,
    clear: () => setError(null),
    clearConflict: () => setConflict(null),
  };
}

type DateConflict = 'shrink_project' | 'extend_program';

/** CR-26: a project would end after its program - make the dates coincide one way or the other.
 *  The server decides; extending a program is admin-only there too. */
function DateConflictChoice({
  date,
  canExtend,
  onPick,
  onCancel,
}: {
  date: string;
  canExtend: boolean;
  onPick: (how: DateConflict) => void;
  onCancel: () => void;
}) {
  return (
    <Alert tone="warning">
      <div data-testid="date-conflict">
        <p>{t('admin.dateConflict', { date })}</p>
        <div className={c.actions}>
          <Button onClick={() => onPick('shrink_project')} data-testid="conflict-shrink">
            {t('admin.conflictShrink', { date })}
          </Button>
          {canExtend ? (
            <Button onClick={() => onPick('extend_program')} data-testid="conflict-extend">
              {t('admin.conflictExtend')}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onCancel}>
            {t('card.cancel')}
          </Button>
        </div>
      </div>
    </Alert>
  );
}

// ------------------------------------------------------------------ teams
export function AdminTeams() {
  const me = useContextData();
  const isAdmin = me.user.role === 'admin';
  const teams = useTeams();
  const { create, remove } = useTeamMutations();
  const { error, fields, run } = useRun();
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<Team | null>(null);
  // CR-11: a lead sees only the teams they lead, and cannot create or delete a team.
  const visible = (teams.data?.items ?? []).filter(
    (tm) => isAdmin || me.leadTeamIds.includes(tm.id),
  );
  return (
    <section className={o.section} data-testid="admin-teams">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!isAdmin ? <p className={c.hint}>{t('admin.leadScope')}</p> : null}
      {isAdmin ? (
        <form
          className={c.newCard}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!name.trim()) return;
            void run(() => create.mutateAsync({ name: name.trim() })).then(
              (ok) => ok && setName(''),
            );
          }}
        >
          <label className="visually-hidden" htmlFor="team-name">
            {t('admin.teamName')}
          </label>
          <input
            id="team-name"
            className={cx(c.input, fields['name'] && c.invalid)}
            value={name}
            maxLength={80}
            placeholder={t('admin.teamName')}
            onChange={(e) => setName(e.target.value)}
            required
            data-testid="team-name"
          />
          <Button type="submit" variant="primary" busy={create.isPending}>
            {t('admin.addTeam')}
          </Button>
        </form>
      ) : null}
      {teams.isPending ? (
        <Skeleton lines={3} label={t('skeleton.label')} />
      ) : (
        <ul className={o.cardList}>
          {visible.map((tm) => (
            <li key={tm.id} className={o.cardItem} data-testid={`admin-team-${tm.id}`}>
              <Link to={`/admin/teams/${tm.id}`} className={o.cardTitle}>
                {tm.name}
              </Link>
              <span className={c.hint}>{t('teams.members', { n: String(tm.memberCount) })}</span>
              {isAdmin ? (
                <div className={c.actions}>
                  <Button variant="ghost" onClick={() => setDeleting(tm)} data-testid="team-delete">
                    {t('card.delete')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('admin.deleteTeam', { name: deleting?.name ?? '' })}
        confirmLabel={t('card.delete')}
        cancelLabel={t('card.cancel')}
        busy={remove.isPending}
        error={error}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          void run(() => remove.mutateAsync(deleting?.id ?? '')).then(
            (ok) => ok && setDeleting(null),
          )
        }
        testId="delete-team"
      >
        {t('admin.deleteTeamBody')}
      </ConfirmDialog>
    </section>
  );
}

export function AdminTeamDetail() {
  const { id = '' } = useParams();
  const me = useContextData();
  const isAdmin = me.user.role === 'admin';
  const team = useTeam(id);
  const users = useUsers();
  const { update, addMember } = useTeamMutations();
  const { error, fields, run } = useRun();
  const [form, setForm] = useState<{ name: string; description: string } | null>(null);
  const [webhook, setWebhook] = useState('');
  const [userId, setUserId] = useState('');
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  if (!isAdmin && !me.leadTeamIds.includes(id)) return <PermissionDenied />;
  if (team.isPending) return <Skeleton lines={4} label={t('skeleton.label')} />;
  if (!team.data) return <Alert tone="danger">{t('problem.NOT_FOUND')}</Alert>;
  const tm = team.data;
  const f = form ?? { name: tm.name, description: tm.description };
  const memberIds = new Set(tm.members.map((m) => m.id));
  const candidates = (users.data?.items ?? []).filter((u) => !memberIds.has(u.id));
  return (
    <section className={o.section} data-testid="admin-team-detail">
      <Link to="/admin" className={c.hint}>
        {'← '}
        {t('admin.teams')}
      </Link>
      <h2 className={o.sectionTitle}>{tm.name}</h2>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <form
        className={c.form}
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => update.mutateAsync({ id: tm.id, body: f })).then(
            (ok) => ok && setForm(null),
          );
        }}
        data-testid="team-form"
      >
        <label className={c.field}>
          <span>{t('admin.teamName')}</span>
          <input
            className={cx(c.input, fields['name'] && c.invalid)}
            value={f.name}
            maxLength={80}
            onChange={(e) => setForm({ ...f, name: e.target.value })}
            required
            data-testid="team-edit-name"
          />
          {fields['name'] ? <span className={c.fieldError}>{fields['name']}</span> : null}
        </label>
        <label className={c.field}>
          <span>{t('card.description')}</span>
          <textarea
            className={cx(c.input, c.textarea)}
            rows={2}
            maxLength={2000}
            value={f.description}
            onChange={(e) => setForm({ ...f, description: e.target.value })}
          />
        </label>
        <div className={c.actions}>
          <Button type="submit" variant="primary" busy={update.isPending}>
            {t('card.save')}
          </Button>
        </div>
      </form>

      <h3 className={o.sectionTitle}>{t('admin.teamsWebhook')}</h3>
      <p className={c.hint}>
        {t('admin.teamsWebhookHint')}{' '}
        {t(tm.teamsWebhook === 'set' ? 'admin.webhookSet' : 'admin.webhookNotSet')}
      </p>
      <form
        className={c.newCard}
        onSubmit={(e) => {
          e.preventDefault();
          if (!webhook.trim()) return;
          void run(() =>
            update.mutateAsync({ id: tm.id, body: { teamsWebhookUrl: webhook.trim() } }),
          ).then((ok) => ok && setWebhook(''));
        }}
      >
        <label className="visually-hidden" htmlFor="teams-webhook">
          {t('admin.teamsWebhook')}
        </label>
        <input
          id="teams-webhook"
          className={cx(c.input, fields['teamsWebhookUrl'] && c.invalid)}
          type="url"
          placeholder="https://…webhook.office.com/…"
          value={webhook}
          onChange={(e) => setWebhook(e.target.value)}
          data-testid="teams-webhook"
        />
        <Button
          type="submit"
          variant="primary"
          busy={update.isPending}
          data-testid="teams-webhook-save"
        >
          {t('card.save')}
        </Button>
        {tm.teamsWebhook === 'set' ? (
          <Button
            variant="ghost"
            onClick={() =>
              void run(() => update.mutateAsync({ id: tm.id, body: { teamsWebhookUrl: null } }))
            }
            data-testid="teams-webhook-clear"
          >
            {t('admin.webhookClear')}
          </Button>
        ) : null}
      </form>

      <h3 className={o.sectionTitle}>{t('admin.members')}</h3>
      <form
        className={c.newCard}
        onSubmit={(e) => {
          e.preventDefault();
          if (!userId) return;
          void run(() => addMember.mutateAsync({ id: tm.id, userId })).then(
            (ok) => ok && setUserId(''),
          );
        }}
      >
        <label className="visually-hidden" htmlFor="add-member">
          {t('admin.addMember')}
        </label>
        <select
          id="add-member"
          className={c.input}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          data-testid="add-member-select"
        >
          <option value="">{t('admin.pickUser')}</option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              {`${u.name} (${u.email})`}
            </option>
          ))}
        </select>
        <Button type="submit" variant="primary" busy={addMember.isPending} data-testid="add-member">
          {t('admin.addMember')}
        </Button>
      </form>
      <ul className={o.cardList}>
        {tm.members.length === 0 ? <li className={c.hint}>{t('admin.noMembers')}</li> : null}
        {tm.members.map((m) => (
          <li key={m.id} className={o.cardItem} data-testid={`member-${m.id}`}>
            <span className={o.cardTitle}>
              {m.name}
              {m.isLead ? (
                <>
                  {' '}
                  <Pill tone="accent" title={t('admin.leadHint')}>
                    {t('admin.lead')}
                  </Pill>
                </>
              ) : null}
            </span>
            <span className={c.hint}>{m.email}</span>
            <div className={c.actions}>
              <Button variant="ghost" onClick={() => setRemoving(m)} data-testid="member-remove">
                {t('admin.remove')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {removing ? (
        <RemoveMemberDialog
          teamId={tm.id}
          teamName={tm.name}
          member={removing}
          members={tm.members}
          onClose={() => setRemoving(null)}
        />
      ) : null}
      <OrgHistory kind="teams" id={tm.id} />
    </section>
  );
}

/** D-050: list the person's open cards in this team; reassign any; the rest are released. */
function RemoveMemberDialog({
  teamId,
  teamName,
  member,
  members,
  onClose,
}: {
  teamId: string;
  teamName: string;
  member: { id: string; name: string };
  members: { id: string; name: string; status?: string | null }[];
  onClose: () => void;
}) {
  const open = useBoard({ kind: 'team', teamId }, { assigneeId: member.id });
  const { removeMember } = useTeamMutations();
  const { error, run } = useRun();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const cards: Card[] = Object.entries(open.data?.columns ?? {})
    .filter(([state]) => state !== 'delivered' && state !== 'cancelled')
    .flatMap(([, list]) => list);
  // D-126: cards go only to someone who has signed in.
  const others = members.filter((m) => m.id !== member.id && m.status === 'active');
  const releasing = cards.filter((c) => !choices[c.key]).length;
  return (
    <ConfirmDialog
      open
      title={t('admin.removeMember', { name: member.name, team: teamName })}
      confirmLabel={t('admin.remove')}
      cancelLabel={t('card.cancel')}
      busy={removeMember.isPending}
      error={error}
      onCancel={onClose}
      onConfirm={() =>
        void run(() =>
          removeMember.mutateAsync({
            id: teamId,
            userId: member.id,
            reassignments: Object.entries(choices)
              .filter(([, assigneeId]) => assigneeId)
              .map(([key, assigneeId]) => ({ key, assigneeId })),
          }),
        ).then((ok) => ok && onClose())
      }
      testId="remove-member"
    >
      {open.isPending ? (
        <Skeleton lines={2} label={t('skeleton.label')} />
      ) : cards.length === 0 ? (
        <p>{t('admin.removeNoCards')}</p>
      ) : (
        <>
          <p>{t('admin.removeLead', { n: String(cards.length) })}</p>
          {/* CR-17: every unset row defaults to release, and a released card now drops back to
              the team's Backlog - say so, with the count, before the admin clicks through. */}
          {releasing > 0 ? (
            <Alert tone="warning">{t('admin.releaseWarning', { n: String(releasing) })}</Alert>
          ) : null}
          <ul className={o.cardList}>
            {cards.map((card) => (
              <li key={card.id} className={o.cardItem} data-testid={`reassign-${card.key}`}>
                <span>
                  <span className={c.key}>{card.key}</span> {card.title}
                </span>
                <select
                  className={c.input}
                  aria-label={t('admin.reassignTo', { key: card.key })}
                  value={choices[card.key] ?? ''}
                  onChange={(e) => setChoices({ ...choices, [card.key]: e.target.value })}
                  data-testid={`reassign-select-${card.key}`}
                >
                  <option value="">{t('admin.release')}</option>
                  {others.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </>
      )}
    </ConfirmDialog>
  );
}

// ------------------------------------------------------------------ programs
export function AdminPrograms() {
  const programs = usePrograms();
  const { create, update, remove } = useProgramMutations();
  const projects = useProjects({});
  const projectMut = useProjectMutations();
  const { error, fields, run, conflict, clearConflict } = useRun();
  const blank = { name: '', description: '', targetDate: '' };
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<Program | null>(null);
  const [deleting, setDeleting] = useState<Program | null>(null);
  const [attach, setAttach] = useState('');
  // The action a DATE_CONFLICT answer re-sends with the chosen resolution.
  const retry = useRef<(how: DateConflict) => void>(() => undefined);
  // CR-26: projects are attached in the program edit window, and only here.
  const attached = (projects.data?.items ?? []).filter((p) => p.program?.id === editing?.id);
  const loose = (projects.data?.items ?? []).filter((p) => p.program === null);
  function link(projectId: string, programId: string | null, how?: DateConflict) {
    retry.current = (h) => link(projectId, programId, h);
    void run(() =>
      projectMut.update.mutateAsync({
        id: projectId,
        body: { programId, ...(how ? { dateConflict: how } : {}) },
      }),
    ).then((ok) => ok && setAttach(''));
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    save();
  }
  function save(how?: DateConflict) {
    retry.current = save;
    const body = {
      name: form.name.trim(),
      description: form.description,
      targetDate: form.targetDate || null,
      ...(how ? { dateConflict: how } : {}),
    };
    void run(() =>
      editing ? update.mutateAsync({ id: editing.id, body }) : create.mutateAsync(body),
    ).then((ok) => {
      if (ok) {
        setForm(blank);
        setEditing(null);
      }
    });
  }
  return (
    <section className={o.section} data-testid="admin-programs">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <form className={c.form} onSubmit={submit} data-testid="program-form">
        <div className={c.row}>
          <label className={c.field}>
            <span>{t('admin.programName')}</span>
            <input
              className={cx(c.input, fields['name'] && c.invalid)}
              value={form.name}
              maxLength={120}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              data-testid="program-name"
            />
            {fields['name'] ? <span className={c.fieldError}>{fields['name']}</span> : null}
          </label>
          <label className={c.field}>
            <span>{t('admin.targetDate')}</span>
            <input
              className={c.input}
              type="date"
              value={form.targetDate}
              onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
              data-testid="program-target"
            />
          </label>
        </div>
        <label className={c.field}>
          <span>{t('card.description')}</span>
          <textarea
            className={cx(c.input, c.textarea)}
            rows={2}
            maxLength={5000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <div className={c.actions}>
          <Button
            type="submit"
            variant="primary"
            busy={create.isPending || update.isPending}
            data-testid="program-submit"
          >
            {editing ? t('card.save') : t('admin.addProgram')}
          </Button>
          {editing ? (
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setForm(blank);
              }}
            >
              {t('card.cancel')}
            </Button>
          ) : null}
        </div>
        {conflict !== null ? (
          <DateConflictChoice
            date={conflict}
            canExtend
            onPick={(how) => retry.current(how)}
            onCancel={clearConflict}
          />
        ) : null}
        {editing ? (
          <fieldset className={c.fieldset} data-testid="program-projects">
            <legend>{t('admin.programProjects')}</legend>
            {attached.length === 0 ? <span className={c.hint}>{t('admin.noProjects')}</span> : null}
            {attached.map((p) => (
              <div key={p.id} className={c.actions} data-testid={`attached-${p.id}`}>
                <span>
                  {`${p.team.name} / ${p.name}`}
                  {p.targetDate ? ` · ${t('programs.target', { date: p.targetDate })}` : ''}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => link(p.id, null)}
                  data-testid="project-detach"
                >
                  {t('admin.detach')}
                </Button>
              </div>
            ))}
            <div className={c.actions}>
              <select
                className={c.input}
                aria-label={t('admin.attachProject')}
                value={attach}
                onChange={(e) => setAttach(e.target.value)}
                data-testid="project-attach-pick"
              >
                <option value="">{t('admin.attachProject')}</option>
                {loose.map((p) => (
                  <option key={p.id} value={p.id}>
                    {`${p.team.name} / ${p.name}${p.targetDate ? ` (${p.targetDate})` : ''}`}
                  </option>
                ))}
              </select>
              <Button
                disabled={!attach}
                onClick={() => link(attach, editing.id)}
                data-testid="project-attach"
              >
                {t('admin.attach')}
              </Button>
            </div>
          </fieldset>
        ) : null}
      </form>
      {programs.isPending ? (
        <Skeleton lines={3} label={t('skeleton.label')} />
      ) : (
        <ul className={o.cardList}>
          {(programs.data?.items ?? []).map((p) => (
            <li key={p.id} className={o.cardItem} data-testid={`admin-program-${p.id}`}>
              <Link to={`/programs/${p.id}`} className={o.cardTitle}>
                {p.name}
              </Link>
              <span className={c.hint}>
                {t('programs.target', { date: p.targetDate ?? t('card.none') })}
                {' · '}
                {t('programs.derived', { date: p.derivedTargetDate ?? t('card.none') })}
                {' · '}
                {t('admin.projectCount', { n: String(p.projectCount) })}
              </span>
              <div className={c.actions}>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(p);
                    setForm({
                      name: p.name,
                      description: p.description,
                      targetDate: p.targetDate ?? '',
                    });
                  }}
                  data-testid="program-edit"
                >
                  {t('card.edit')}
                </Button>
                <Button variant="ghost" onClick={() => setDeleting(p)} data-testid="program-delete">
                  {t('card.delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('admin.deleteProgram', { name: deleting?.name ?? '' })}
        confirmLabel={t('card.delete')}
        cancelLabel={t('card.cancel')}
        busy={remove.isPending}
        error={error}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          void run(() => remove.mutateAsync(deleting?.id ?? '')).then(
            (ok) => ok && setDeleting(null),
          )
        }
        testId="delete-program"
      >
        {t('admin.deleteProgramBody')}
      </ConfirmDialog>
    </section>
  );
}

// ------------------------------------------------------------------ projects
export function AdminProjects() {
  const me = useContextData();
  const isAdmin = me.user.role === 'admin';
  const [includeClosed, setIncludeClosed] = useState(false);
  const projects = useProjects({ includeClosed });
  const teams = useTeams();
  const { create, update, remove, reopen } = useProjectMutations();
  const { error, fields, run, conflict, clearConflict } = useRun();
  const blank = { name: '', description: '', teamId: '', targetDate: '' };
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  // CR-12
  const [closing, setClosing] = useState<Project | null>(null);
  const [reopening, setReopening] = useState<Project | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    save();
  }
  // CR-26: the program is attached from the program edit window, not here.
  function save(how?: DateConflict) {
    const common = {
      name: form.name.trim(),
      description: form.description,
      targetDate: form.targetDate || null,
      ...(how ? { dateConflict: how } : {}),
    };
    void run(() =>
      editing
        ? update.mutateAsync({
            id: editing.id,
            body: { ...common, ...(form.teamId ? { teamId: form.teamId } : {}) },
          })
        : create.mutateAsync({ ...common, teamId: form.teamId }),
    ).then((ok) => {
      if (ok) {
        setForm(blank);
        setEditing(null);
      }
    });
  }
  // CR-11: a lead only picks from, and only sees, their own teams' projects.
  const myTeams = (teams.data?.items ?? []).filter(
    (tm) => isAdmin || me.leadTeamIds.includes(tm.id),
  );
  const visible = (projects.data?.items ?? []).filter(
    (p) => isAdmin || me.leadTeamIds.includes(p.team.id),
  );
  return (
    <section className={o.section} data-testid="admin-projects">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!isAdmin ? <p className={c.hint}>{t('admin.leadScope')}</p> : null}
      <form className={c.form} onSubmit={submit} data-testid="project-form">
        <div className={c.row}>
          <label className={c.field}>
            <span>{t('admin.projectName')}</span>
            <input
              className={cx(c.input, fields['name'] && c.invalid)}
              value={form.name}
              maxLength={120}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              data-testid="project-name"
            />
            {fields['name'] ? <span className={c.fieldError}>{fields['name']}</span> : null}
          </label>
          <label className={c.field}>
            <span>{t('card.team')}</span>
            <select
              className={cx(c.input, fields['teamId'] && c.invalid)}
              value={form.teamId}
              onChange={(e) => setForm({ ...form, teamId: e.target.value })}
              required
              data-testid="project-team"
            >
              <option value="">{t('admin.pickTeam')}</option>
              {myTeams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </select>
            {editing ? <span className={c.hint}>{t('admin.reteamHint')}</span> : null}
          </label>
          <label className={c.field}>
            <span>{t('admin.targetDate')}</span>
            <input
              className={c.input}
              type="date"
              value={form.targetDate}
              onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
              data-testid="project-target"
            />
            {editing?.program ? (
              <span className={c.hint}>{t('admin.inProgram', { name: editing.program.name })}</span>
            ) : null}
          </label>
        </div>
        <label className={c.field}>
          <span>{t('card.description')}</span>
          <textarea
            className={cx(c.input, c.textarea)}
            rows={2}
            maxLength={5000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <div className={c.actions}>
          <Button
            type="submit"
            variant="primary"
            busy={create.isPending || update.isPending}
            data-testid="project-submit"
          >
            {editing ? t('card.save') : t('admin.addProject')}
          </Button>
          {editing ? (
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setForm(blank);
              }}
            >
              {t('card.cancel')}
            </Button>
          ) : null}
        </div>
        {conflict !== null ? (
          <DateConflictChoice
            date={conflict}
            canExtend={isAdmin}
            onPick={save}
            onCancel={clearConflict}
          />
        ) : null}
      </form>
      <label className={c.check}>
        <input
          type="checkbox"
          checked={includeClosed}
          onChange={(e) => setIncludeClosed(e.target.checked)}
          data-testid="project-include-closed"
        />
        {t('projects.includeClosed')}
      </label>
      {projects.isPending ? (
        <Skeleton lines={3} label={t('skeleton.label')} />
      ) : (
        <ul className={o.cardList}>
          {visible.map((p) => (
            <li key={p.id} className={o.cardItem} data-testid={`admin-project-${p.id}`}>
              <Link to={`/projects/${p.id}`} className={o.cardTitle}>
                {p.name}
              </Link>
              <span className={c.hint}>
                {p.team.name}
                {p.program ? ` · ${p.program.name}` : ''}
                {' · '}
                {t('projects.open', { open: String(p.openCardCount), total: String(p.cardCount) })}
                {p.targetDate ? ` · ${t('programs.target', { date: p.targetDate })}` : ''}
                {p.closedAt
                  ? ` · ${t('projects.closedOn', {
                      date: p.closedAt.slice(0, 10),
                      name: p.closedBy?.name ?? '',
                    })}`
                  : ''}
              </span>
              <div className={c.actions}>
                {/* CR-12: the X is the intake stop the user asked for, admin-only both ways. */}
                {isAdmin && !p.closedAt ? (
                  <Button
                    variant="ghost"
                    aria-label={p.accepting ? t('admin.stopIntake') : t('admin.resumeIntake')}
                    title={p.accepting ? t('projects.acceptingTip') : t('projects.stoppedTip')}
                    aria-pressed={!p.accepting}
                    onClick={() =>
                      void run(() =>
                        update.mutateAsync({ id: p.id, body: { accepting: !p.accepting } }),
                      )
                    }
                    data-testid={`project-intake-${p.id}`}
                  >
                    <Icon name={p.accepting ? 'check' : 'x'} size={18} />
                  </Button>
                ) : null}
                {isAdmin ? (
                  <Button
                    variant="ghost"
                    onClick={() => (p.closedAt ? setReopening(p) : setClosing(p))}
                    data-testid={p.closedAt ? 'project-reopen' : 'project-close'}
                  >
                    {p.closedAt ? t('admin.reopenProject') : t('admin.closeProject')}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(p);
                    setForm({
                      name: p.name,
                      description: p.description,
                      teamId: p.team.id,
                      targetDate: p.targetDate ?? '',
                    });
                  }}
                  data-testid="project-edit"
                >
                  {t('card.edit')}
                </Button>
                <Button variant="ghost" onClick={() => setDeleting(p)} data-testid="project-delete">
                  {t('card.delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('admin.deleteProject', { name: deleting?.name ?? '' })}
        confirmLabel={t('card.delete')}
        cancelLabel={t('card.cancel')}
        busy={remove.isPending}
        error={error}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          void run(() => remove.mutateAsync(deleting?.id ?? '')).then(
            (ok) => ok && setDeleting(null),
          )
        }
        testId="delete-project"
      >
        {t('admin.deleteProjectBody')}
      </ConfirmDialog>
      {closing ? <CloseProjectDialog project={closing} onDone={() => setClosing(null)} /> : null}
      <ConfirmDialog
        open={reopening !== null}
        title={t('admin.reopenProjectTitle', { name: reopening?.name ?? '' })}
        confirmLabel={t('admin.reopenProject')}
        cancelLabel={t('card.cancel')}
        busy={reopen.isPending}
        error={error}
        onCancel={() => setReopening(null)}
        onConfirm={() =>
          void run(() => reopen.mutateAsync(reopening?.id ?? '')).then(
            (ok) => ok && setReopening(null),
          )
        }
        testId="reopen-project"
      >
        {t('admin.reopenProjectBody')}
      </ConfirmDialog>
    </section>
  );
}

/**
 * CR-12: closure with a card checklist. Every open card of the project must be ticked here - it is
 * then closed to Cancelled (or Delivered per row) with this comment written onto it - or moved out
 * of the project first. The server refuses the whole call if one is left open, so the list below is
 * a convenience, not the rule.
 */
function CloseProjectDialog({ project, onDone }: { project: Project; onDone: () => void }) {
  const open = useSearch({ projectId: project.id, includeClosed: false, limit: 100 });
  const { close } = useProjectMutations();
  const { error, run } = useRun();
  const [comment, setComment] = useState('');
  const [ticked, setTicked] = useState<Record<string, 'cancelled' | 'delivered'>>({});
  const items = open.data?.items ?? [];
  const total = open.data?.total ?? 0;
  const ready = comment.trim() !== '' && items.every((card) => ticked[card.key]);
  return (
    <ConfirmDialog
      open
      title={t('admin.closeProjectTitle', { name: project.name })}
      confirmLabel={t('admin.closeProject')}
      cancelLabel={t('card.cancel')}
      busy={close.isPending}
      error={error}
      onCancel={onDone}
      onConfirm={() => {
        if (!ready) return;
        void run(() =>
          close.mutateAsync({
            id: project.id,
            body: {
              comment: comment.trim(),
              cards: items.map((card) => ({
                key: card.key,
                state: ticked[card.key] ?? 'cancelled',
              })),
            },
          }),
        ).then((ok) => ok && onDone());
      }}
      testId="close-project"
    >
      <p className={c.hint}>{t('admin.closeProjectBody')}</p>
      {open.isPending ? (
        <Skeleton lines={3} label={t('skeleton.label')} />
      ) : items.length === 0 ? (
        <p className={c.hint}>{t('admin.closeNoOpen')}</p>
      ) : (
        <>
          {total > items.length ? (
            <Alert tone="warning">
              {t('admin.closeMore', { shown: String(items.length), total: String(total) })}
            </Alert>
          ) : null}
          <ul className={o.cardList} data-testid="close-open-cards">
            {items.map((card) => (
              <li key={card.id} className={o.cardItem} data-testid={`close-card-${card.key}`}>
                <label className={c.check}>
                  <input
                    type="checkbox"
                    checked={Boolean(ticked[card.key])}
                    onChange={(e) =>
                      setTicked((prev) => {
                        const next = { ...prev };
                        if (e.target.checked) next[card.key] = 'cancelled';
                        else delete next[card.key];
                        return next;
                      })
                    }
                    data-testid={`close-tick-${card.key}`}
                  />
                  {`${card.key} ${card.title}`}
                </label>
                <select
                  className={c.input}
                  aria-label={t('card.state')}
                  value={ticked[card.key] ?? 'cancelled'}
                  disabled={!ticked[card.key]}
                  onChange={(e) =>
                    setTicked((prev) => ({
                      ...prev,
                      [card.key]: e.target.value as 'cancelled' | 'delivered',
                    }))
                  }
                  data-testid={`close-state-${card.key}`}
                >
                  <option value="cancelled">{t('state.cancelled')}</option>
                  <option value="delivered">{t('state.delivered')}</option>
                </select>
              </li>
            ))}
          </ul>
        </>
      )}
      <label className={c.field}>
        <span>{t('admin.closeComment')}</span>
        <textarea
          className={cx(c.input, c.textarea)}
          rows={3}
          maxLength={5000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          required
          data-testid="close-comment"
        />
        {comment.trim() ? null : <span className={c.hint}>{t('admin.closeCommentRequired')}</span>}
      </label>
    </ConfirmDialog>
  );
}

// ------------------------------------------------------------------ users
type AskedRole = 'member' | 'lead' | 'admin' | 'none';
const ROLE_CHOICES: readonly AskedRole[] = ['member', 'lead', 'admin', 'none'];

function roleLabel(role: string | null | undefined): string {
  return role ? t(`role.${role}` as 'role.member') : t('role.none');
}

/**
 * TT Suite: only the global admin (in the portal) creates accounts and assigns roles. A Kanban
 * admin sees everyone and asks the global admin for a change; the request waits in the portal's
 * inbox until approved, so the person's role here does not change yet.
 */
export function AdminUsers() {
  const users = useAllUsers();
  const requests = useRoleRequests();
  const [asking, setAsking] = useState<UserRef | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = new Map((requests.data?.items ?? []).map((r) => [r.email.toLowerCase(), r]));
  return (
    <section className={o.section} data-testid="admin-users">
      <p className={c.hint}>{t('admin.usersLead')}</p>
      {notice ? (
        <div data-testid="role-request-sent">
          <Alert tone="success">{notice}</Alert>
        </div>
      ) : null}
      {users.isPending ? (
        <Skeleton lines={3} label={t('skeleton.label')} />
      ) : (
        <ul className={o.cardList}>
          {(users.data?.items ?? []).map((u) => {
            const open = pending.get(u.email.toLowerCase());
            return (
              <li key={u.id} className={o.cardItem} data-testid={`user-${u.id}`}>
                <span className={o.cardTitle}>{u.name}</span>
                <span className={c.hint}>{u.email}</span>
                <span className={c.meta}>
                  <Pill tone={u.role === 'admin' ? 'accent' : 'muted'}>{t(`role.${u.role}`)}</Pill>
                  <Pill
                    tone={
                      u.status === 'active'
                        ? 'success'
                        : u.status === 'invited'
                          ? 'warning'
                          : 'muted'
                    }
                  >
                    {t(`status.${u.status ?? 'active'}` as 'status.active')}
                  </Pill>
                  {open ? (
                    <span data-testid={`role-requested-${u.id}`}>
                      <Pill tone="warning">
                        {t('admin.requested', { role: roleLabel(open.role) })}
                      </Pill>
                    </span>
                  ) : null}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setNotice(null);
                      setAsking(u);
                    }}
                    data-testid={`role-request-${u.id}`}
                  >
                    {t('admin.requestRole')}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {asking ? (
        <RoleRequestDialog
          user={asking}
          onClose={() => setAsking(null)}
          onSent={() => {
            setAsking(null);
            setNotice(t('admin.roleRequestSent'));
          }}
        />
      ) : null}
    </section>
  );
}

function RoleRequestDialog({
  user,
  onClose,
  onSent,
}: {
  user: UserRef;
  onClose: () => void;
  onSent: () => void;
}) {
  const teams = useTeams();
  const ask = useRequestRoleChange();
  const { error, fields, run } = useRun();
  const [role, setRole] = useState<AskedRole>(user.role === 'admin' ? 'admin' : 'member');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const toggleTeam = (id: string, on: boolean) =>
    setTeamIds((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)));
  return (
    <ConfirmDialog
      open
      title={t('admin.requestRoleTitle', { name: user.name })}
      confirmLabel={t('admin.requestRoleSend')}
      cancelLabel={t('card.cancel')}
      busy={ask.isPending}
      error={error}
      onCancel={onClose}
      onConfirm={() =>
        void run(() =>
          ask.mutateAsync({
            id: user.id,
            body: {
              role: role === 'none' ? null : role,
              teamIds: role === 'lead' ? teamIds : [],
              note: note.trim(),
            },
          }),
        ).then((ok) => ok && onSent())
      }
      testId="role-request"
    >
      <p className={c.hint}>{t('admin.requestRoleHint')}</p>
      <fieldset className={c.field}>
        <legend>{t('admin.requestRoleRole')}</legend>
        <div className={c.row}>
          {ROLE_CHOICES.map((r) => (
            <label key={r} className={c.check}>
              <input
                type="radio"
                name="asked-role"
                value={r}
                checked={role === r}
                onChange={() => setRole(r)}
                data-testid={`role-choice-${r}`}
              />
              {roleLabel(r === 'none' ? null : r)}
            </label>
          ))}
        </div>
        {fields['role'] ? <span className={c.fieldError}>{fields['role']}</span> : null}
      </fieldset>
      {role === 'lead' ? (
        <fieldset className={c.field} data-testid="role-request-teams">
          <legend className="required-mark">{t('admin.requestRoleTeams')}</legend>
          <div className={c.row}>
            {(teams.data?.items ?? []).map((tm) => (
              <label key={tm.id} className={c.check}>
                <input
                  type="checkbox"
                  checked={teamIds.includes(tm.id)}
                  onChange={(e) => toggleTeam(tm.id, e.target.checked)}
                  data-testid={`role-team-${tm.id}`}
                />
                {tm.name}
              </label>
            ))}
          </div>
          {fields['teamIds'] ? <span className={c.fieldError}>{fields['teamIds']}</span> : null}
        </fieldset>
      ) : null}
      <label className={c.field}>
        <span>{t('admin.requestRoleNote')}</span>
        <textarea
          className={cx(c.input, c.textarea)}
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          data-testid="role-request-note"
        />
      </label>
    </ConfirmDialog>
  );
}

// ------------------------------------------------------------------ tags (D-062)
export function AdminTags() {
  const tags = useTags();
  const { create, rename, remove } = useTagMutations();
  const { error, fields, run } = useRun();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  return (
    <section className={o.section} data-testid="admin-tags">
      <p className={c.hint}>{t('admin.tagsLead')}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <form
        className={c.newCard}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!name.trim()) return;
          void run(() => create.mutateAsync(name.trim())).then((ok) => ok && setName(''));
        }}
      >
        <label className="visually-hidden" htmlFor="tag-name">
          {t('admin.tagName')}
        </label>
        <input
          id="tag-name"
          className={cx(c.input, fields['name'] && c.invalid)}
          value={name}
          maxLength={40}
          placeholder={t('admin.tagName')}
          onChange={(e) => setName(e.target.value)}
          required
          data-testid="tag-name"
        />
        <Button type="submit" variant="primary" busy={create.isPending} data-testid="tag-add">
          {t('admin.addTag')}
        </Button>
      </form>
      {tags.isPending ? (
        <Skeleton lines={3} label={t('skeleton.label')} />
      ) : (
        <ul className={o.cardList}>
          {(tags.data?.items ?? []).map((tag) => (
            <li key={tag.id} className={o.cardItem} data-testid={`admin-tag-${tag.name}`}>
              {editing?.id === tag.id ? (
                <form
                  className={c.newCard}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(() =>
                      rename.mutateAsync({ id: tag.id, name: editing.name.trim() }),
                    ).then((ok) => ok && setEditing(null));
                  }}
                >
                  <input
                    className={c.input}
                    value={editing.name}
                    maxLength={40}
                    required
                    aria-label={t('admin.tagName')}
                    onChange={(e) => setEditing({ id: tag.id, name: e.target.value })}
                    data-testid="tag-rename-input"
                  />
                  <Button type="submit" variant="primary" busy={rename.isPending}>
                    {t('card.save')}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(null)}>
                    {t('card.cancel')}
                  </Button>
                </form>
              ) : (
                <span className={o.cardTitle}>{tag.name}</span>
              )}
              <span className={c.hint}>{t('admin.tagCount', { n: String(tag.cardCount) })}</span>
              <div className={c.actions}>
                <Button
                  variant="ghost"
                  onClick={() => setEditing({ id: tag.id, name: tag.name })}
                  data-testid="tag-rename"
                >
                  {t('admin.rename')}
                </Button>
                <Button variant="ghost" onClick={() => setDeleting(tag)} data-testid="tag-delete">
                  {t('card.delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('admin.deleteTag', { name: deleting?.name ?? '' })}
        confirmLabel={t('card.delete')}
        cancelLabel={t('card.cancel')}
        busy={remove.isPending}
        error={error}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          void run(() => remove.mutateAsync(deleting?.id ?? '')).then(
            (ok) => ok && setDeleting(null),
          )
        }
        testId="delete-tag"
      >
        {t('admin.deleteTagBody')}
      </ConfirmDialog>
    </section>
  );
}
