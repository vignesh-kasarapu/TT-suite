// New-card dialog (D-078): opened from the "+" button on every board. Team / project start
// from the board's context: the team board's team, else the project filter, else the person's
// defaults in their chosen order (D-077). The server still decides placement (D-049, D-012).
// CR-22: an org card must have a team - the person's only team is the first default.
// D-127: an org card picks its assignee here - you (the default) or a teammate who has signed in
// (D-126); the server checks the choice and mails the person. D-147: never nobody - a card is up
// for claiming only once its holder releases it.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Button } from '../../components';
import { fieldErrorsOf, problemBanner, type Problem } from '../../api/client';
import { t } from '../../i18n/t';
import { cx } from '../../styles/cx';
import { useContextData, usePreferences } from '../auth/useMe';
import { useProjects, useTeam, useTeams } from '../org/api';
import { useCreateCard, type CardCreate } from './api';
import { TagPicker } from './TagPicker';
import s from './cards.module.css';

export type NewCardContext = {
  plane: 'private' | 'org';
  /** Fixed by the board (team board) - not editable. */
  fixedTeamId?: string;
  /** From the board's project filter, if any. */
  filterProjectId?: string;
  /** Extra fields the board needs on the new card (assignee on the Org tab, start state). */
  extra: Partial<CardCreate>;
};

const ME = 'me';

export function NewCardDialog({
  ctx,
  onClose,
  onCreated,
}: {
  ctx: NewCardContext;
  onClose: () => void;
  onCreated: (key: string) => void;
}) {
  const me = useContextData();
  const prefs = usePreferences(ctx.plane === 'org');
  const allProjects = useProjects();
  // Admins may place a card in any team (D-060) and belong to none, so they pick from them all.
  const isAdmin = me.user.role === 'admin';
  const allTeams = useTeams();
  const teamChoices = isAdmin
    ? (allTeams.data?.items ?? []).map((tm) => ({ id: tm.id, name: tm.name }))
    : me.teams;
  // CR-12: a new card only lands in a project that is accepting (closed ones are not listed at all).
  const openProjects = (allProjects.data?.items ?? []).filter((p) => p.accepting);
  const create = useCreateCard();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: null as number | null, // D-134: no priority unless chosen
    tags: [] as string[],
    eta: '',
    effortHours: '',
    teamId: ctx.fixedTeamId ?? '',
    projectId: '',
    assignee: ME as string,
  });
  const [seeded, setSeeded] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Seed team/project once the project list (and preferences) are known.
  const projectsReady = allProjects.data !== undefined;
  const prefsReady = ctx.plane !== 'org' || prefs.data !== undefined;
  if (!seeded && projectsReady && prefsReady) {
    setSeeded(true);
    if (ctx.plane === 'org') {
      const items = openProjects;
      const teamOf = (pid: string) => items.find((p) => p.id === pid)?.team.id ?? '';
      let teamId = ctx.fixedTeamId ?? '';
      let projectId = '';
      if (ctx.filterProjectId && (!teamId || teamOf(ctx.filterProjectId) === teamId)) {
        projectId = ctx.filterProjectId;
        teamId = teamId || teamOf(projectId);
      } else if (!teamId && prefs.data) {
        const pt = prefs.data.primaryTeamId ?? '';
        const pp = prefs.data.primaryProjectId ?? '';
        if (prefs.data.orgOrder === 'project_first' && pp) {
          projectId = pp;
          teamId = teamOf(pp);
        } else {
          teamId = (me.teams.length === 1 ? (me.teams[0]?.id ?? '') : '') || pt || teamOf(pp);
          if (pp && teamOf(pp) === teamId) projectId = pp;
        }
      } else if (teamId && prefs.data?.primaryProjectId) {
        const pp = prefs.data.primaryProjectId;
        if (teamOf(pp) === teamId) projectId = pp;
      }
      setForm((f) => ({ ...f, teamId, projectId }));
    }
  }

  const teamProjects = openProjects.filter((p) => p.team.id === form.teamId);
  const team = useTeam(ctx.plane === 'org' ? form.teamId : '');
  const teammates = (team.data?.members ?? []).filter(
    (m) => m.status === 'active' && m.id !== me.user.id,
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBanner(null);
    setErrors({});
    const title = form.title.trim();
    if (!title) return;
    const body: CardCreate = {
      title,
      description: form.description,
      priority: form.priority,
      tags: form.tags,
      eta: form.eta || null,
      effortHours: form.effortHours === '' ? null : Number(form.effortHours),
      ...(ctx.plane === 'org'
        ? {
            plane: 'org' as const,
            // Blank = let the server apply the CR-22 default (or refuse with TEAM_REQUIRED).
            ...(form.teamId ? { teamId: form.teamId } : {}),
            projectId: form.projectId || null,
            // Left out = the creator holds it (the server's default).
            ...(form.assignee === ME ? {} : { assigneeId: form.assignee }),
          }
        : {}),
      ...ctx.extra,
    };
    try {
      const card = await create.mutateAsync(body);
      ref.current?.close();
      onClose();
      onCreated(card.key);
    } catch (p) {
      const problem = p as Problem;
      setErrors(fieldErrorsOf(problem));
      setBanner(problemBanner(problem));
    }
  }

  return (
    <dialog
      ref={ref}
      className={s.dialog}
      aria-labelledby="new-card-title-h"
      onClose={onClose}
      data-testid="new-card-dialog"
    >
      <form className={s.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        <h2 id="new-card-title-h" className={s.dialogTitle}>
          {t('board.create')}
        </h2>
        {banner ? <Alert tone="danger">{banner}</Alert> : null}
        <label className={s.field}>
          <span>{t('card.titleField')}</span>
          <input
            className={cx(s.input, errors['title'] && s.invalid)}
            required
            maxLength={200}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            data-testid="new-card-title"
          />
        </label>
        <label className={s.field}>
          <span>{t('card.description')}</span>
          <textarea
            className={cx(s.input, s.textarea)}
            rows={3}
            maxLength={20000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            data-testid="new-card-description"
          />
        </label>
        {ctx.plane === 'org' ? (
          <div className={s.row}>
            <label className={s.field}>
              <span>{t('card.team')}</span>
              <select
                className={cx(s.input, errors['teamId'] && s.invalid)}
                value={form.teamId}
                disabled={ctx.fixedTeamId !== undefined}
                onChange={(e) =>
                  setForm({ ...form, teamId: e.target.value, projectId: '', assignee: ME })
                }
                data-testid="new-card-team"
              >
                <option value="">{t('card.pickTeam')}</option>
                {teamChoices.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name}
                  </option>
                ))}
              </select>
              {errors['teamId'] ? <span className={s.fieldError}>{errors['teamId']}</span> : null}
            </label>
            <label className={s.field}>
              <span>{t('card.project')}</span>
              <select
                className={s.input}
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                disabled={!form.teamId}
                data-testid="new-card-project"
              >
                <option value="">{t('card.noProject')}</option>
                {teamProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={s.field}>
              <span>{t('card.assignee')}</span>
              <select
                className={cx(s.input, errors['assigneeId'] && s.invalid)}
                value={form.assignee}
                onChange={(e) => setForm({ ...form, assignee: e.target.value })}
                data-testid="new-card-assignee"
              >
                <option value={ME}>{t('card.assigneeMe')}</option>
                {teammates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              {errors['assigneeId'] ? (
                <span className={s.fieldError}>{errors['assigneeId']}</span>
              ) : null}
            </label>
          </div>
        ) : null}
        <div className={s.row}>
          <label className={s.field}>
            <span>{t('card.priority')}</span>
            <select
              className={s.input}
              value={form.priority ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  priority: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            >
              <option value="">{t('card.priorityNone')}</option>
              {[1, 2, 3, 4].map((p) => (
                <option key={p} value={p}>
                  {t('card.priorityShort', { n: String(p) })}
                </option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            <span>{t('card.eta')}</span>
            <input
              className={s.input}
              type="date"
              value={form.eta}
              onChange={(e) => setForm({ ...form, eta: e.target.value })}
            />
          </label>
          <label className={s.field}>
            <span>{t('card.effort')}</span>
            <input
              className={s.input}
              type="number"
              min={0}
              step={0.25}
              value={form.effortHours}
              onChange={(e) => setForm({ ...form, effortHours: e.target.value })}
            />
          </label>
        </div>
        <div className={s.field}>
          <span>{t('card.tags')}</span>
          <TagPicker
            value={form.tags}
            onChange={(tags) => setForm({ ...form, tags })}
            testId="new-card-tags"
          />
        </div>
        <div className={s.dialogActions}>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            {t('card.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            busy={create.isPending}
            busyLabel={t('board.creating')}
            data-testid="new-card-submit"
          >
            {t('board.createSubmit')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
