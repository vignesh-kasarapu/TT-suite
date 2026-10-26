// Plane copy dialog (FR-017 / FR-019, D-056): full edit form pre-filled from the source,
// placement (org target), and checklists of comments and history rows to carry over - all
// pre-selected; the user edits or unticks before the linked copy is created.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button } from '../../components';
import { t } from '../../i18n/t';
import { fieldErrorsOf, problemBanner, type Problem } from '../../api/client';
import { cx } from '../../styles/cx';
import { useContextData } from '../auth/useMe';
import { useProjects } from '../org/api';
import { STATES, useCardEvents, useComments, useCopyCard, type Card, type CardState } from './api';
import { STATE_LABEL } from './Board';
import { eventLabel, show } from './CardDetail';
import { TagPicker } from './TagPicker';
import s from './cards.module.css';

export function CopyDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const me = useContextData();
  const navigate = useNavigate();
  const toOrg = card.plane === 'private';
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  const comments = useComments(card.key);
  const events = useCardEvents(card.key);
  const copy = useCopyCard(card.key);
  const [form, setForm] = useState({
    title: card.title,
    description: card.description,
    state: card.state,
    priority: card.priority,
    tags: card.tags,
    eta: card.eta ?? '',
    effortHours: card.effortHours === null ? '' : String(card.effortHours),
    teamId: '',
    projectId: '',
    cancelSource: false,
  });
  const projects = useProjects(form.teamId ? { teamId: form.teamId } : {});
  // Checklists start with everything selected once the lists arrive (derived state, no effect).
  const [excludedComments, setExcludedComments] = useState<Set<string>>(new Set());
  const [excludedEvents, setExcludedEvents] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.delete(id);
    else next.add(id);
    return next;
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBanner(null);
    setErrors({});
    const commentIds = (comments.data?.items ?? [])
      .map((c) => c.id)
      .filter((id) => !excludedComments.has(id));
    const eventIds = (events.data?.items ?? [])
      .map((ev) => ev.id)
      .filter((id) => !excludedEvents.has(id));
    try {
      const created = await copy.mutateAsync({
        targetPlane: toOrg ? 'org' : 'private',
        version: card.version,
        title: form.title,
        description: form.description,
        state: form.state,
        priority: form.priority,
        tags: form.tags,
        eta: form.eta || null,
        effortHours: form.effortHours === '' ? null : Number(form.effortHours),
        // CR-22: blank = the server's default team, or TEAM_REQUIRED when there is none.
        ...(toOrg
          ? { ...(form.teamId ? { teamId: form.teamId } : {}), projectId: form.projectId || null }
          : {}),
        commentIds,
        eventIds,
        cancelSource: toOrg && form.cancelSource,
      });
      onClose();
      void navigate(`/cards/${created.key}`);
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
      aria-labelledby="copy-title"
      onClose={onClose}
      data-testid="copy-dialog"
    >
      <form className={s.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        <h2 id="copy-title" className={s.dialogTitle}>
          {t(toOrg ? 'copy.titleToOrg' : 'copy.titleToPrivate', { key: card.key })}
        </h2>
        <p className={s.hint}>{t(toOrg ? 'copy.leadToOrg' : 'copy.leadToPrivate')}</p>
        {banner ? <Alert tone="danger">{banner}</Alert> : null}
        <label className={s.field}>
          <span>{t('card.titleField')}</span>
          <input
            className={cx(s.input, errors['title'] && s.invalid)}
            required
            maxLength={200}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            data-testid="copy-title-input"
          />
        </label>
        <label className={s.field}>
          <span>{t('card.description')}</span>
          <textarea
            className={cx(s.input, s.textarea)}
            rows={4}
            maxLength={20000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            data-testid="copy-description"
          />
        </label>
        {toOrg ? (
          <div className={s.row}>
            <label className={s.field}>
              <span>{t('card.team')}</span>
              <select
                className={cx(s.input, errors['teamId'] && s.invalid)}
                value={form.teamId}
                onChange={(e) => setForm({ ...form, teamId: e.target.value, projectId: '' })}
                data-testid="copy-team"
              >
                <option value="">{t('card.pickTeam')}</option>
                {me.teams.map((tm) => (
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
                data-testid="copy-project"
              >
                <option value="">{t('card.noProject')}</option>
                {(projects.data?.items ?? [])
                  .filter((p) => p.accepting) // CR-12
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        ) : null}
        <div className={s.row}>
          <label className={s.field}>
            <span>{t('card.state')}</span>
            <select
              className={s.input}
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value as CardState })}
            >
              {STATES.map((o) => (
                <option key={o} value={o}>
                  {t(STATE_LABEL[o])}
                </option>
              ))}
            </select>
          </label>
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
            testId="copy-tags"
          />
        </div>

        <fieldset className={s.fieldset}>
          <legend>
            {t('copy.comments', {
              n: String((comments.data?.items.length ?? 0) - excludedComments.size),
            })}
          </legend>
          {(comments.data?.items ?? []).length === 0 ? (
            <span className={s.hint}>{t('copy.noComments')}</span>
          ) : null}
          {(comments.data?.items ?? []).map((c) => (
            <label key={c.id} className={s.check}>
              <input
                type="checkbox"
                checked={!excludedComments.has(c.id)}
                onChange={(e) =>
                  setExcludedComments(toggle(excludedComments, c.id, e.target.checked))
                }
                data-testid="copy-comment"
              />
              <span className={s.truncate}>{c.body}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className={s.fieldset}>
          <legend>
            {t('copy.history', {
              n: String((events.data?.items.length ?? 0) - excludedEvents.size),
            })}
          </legend>
          <div className={s.actions}>
            <Button variant="ghost" onClick={() => setExcludedEvents(new Set())}>
              {t('copy.all')}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                setExcludedEvents(new Set((events.data?.items ?? []).map((ev) => ev.id)))
              }
              data-testid="copy-history-none"
            >
              {t('copy.none')}
            </Button>
          </div>
          <div className={s.checklist}>
            {(events.data?.items ?? []).map((ev) => (
              <label key={ev.id} className={s.check}>
                <input
                  type="checkbox"
                  checked={!excludedEvents.has(ev.id)}
                  onChange={(e) =>
                    setExcludedEvents(toggle(excludedEvents, ev.id, e.target.checked))
                  }
                  data-testid="copy-event"
                />
                <span className={s.truncate}>
                  {eventLabel(ev.field)}
                  {ev.field !== 'created' ? `: ${show(ev.oldValue)} → ${show(ev.newValue)}` : ''}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {toOrg ? (
          <label className={s.check}>
            <input
              type="checkbox"
              checked={form.cancelSource}
              onChange={(e) => setForm({ ...form, cancelSource: e.target.checked })}
              data-testid="copy-cancel-source"
            />
            {t('copy.cancelSource')}
          </label>
        ) : null}
        <div className={s.dialogActions}>
          <Button variant="secondary" onClick={onClose} disabled={copy.isPending}>
            {t('card.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            busy={copy.isPending}
            busyLabel={t('copy.creating')}
            data-testid="copy-submit"
          >
            {t(toOrg ? 'copy.submitToOrg' : 'copy.submitToPrivate')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
