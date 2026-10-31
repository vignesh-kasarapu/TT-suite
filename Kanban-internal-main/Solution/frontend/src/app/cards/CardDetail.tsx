// Card detail (FR-055): details form, comments, links, history, plane copy. Same component as
// a modal window over the board (tablet/desktop, CR-25) and as a full page (mobile). Write
// access is decided by the server; the form only hints at it (UX).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert, Button, ErrorState, Pill, Skeleton } from '../../components';
import { Icon } from '../../components/Icon';
import { MQ, useMediaQuery } from '../../components/useMediaQuery';
import { t } from '../../i18n/t';
import { asProblem, fieldErrorsOf, problemBanner, type Problem } from '../../api/client';
import { cx } from '../../styles/cx';
import { useContextData } from '../auth/useMe';
import { pageTitleClass } from '../Shell';
import { useProjects, useTeam, useUsers } from '../org/api';
import {
  STATES,
  useCard,
  useCardEvents,
  useMoveCard,
  useUpdateCard,
  type Card,
  type CardState,
} from './api';
import { STATE_LABEL } from './Board';
import { CopyDialog } from './CopyDialog';
import { Links } from './Links';
import { Files } from './Files';
import { FieldHistory, Time } from './Time';
import { Comments } from './Comments';
import { Markdown } from './Markdown';
import { TagPicker } from './TagPicker';
import s from './cards.module.css';

type Tab = 'details' | 'comments' | 'links' | 'files' | 'time' | 'history';

/** Route element for /cards/:key. A modal window over the dimmed board from 640 px (CR-25),
 *  full page below. */
export function CardRoute() {
  const { key = '' } = useParams();
  const tabletUp = useMediaQuery(MQ.tabletUp);
  const navigate = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, [tabletUp]);
  // D-163: on a phone the card replaces the board, so it starts at the top of the page.
  useEffect(() => {
    if (!tabletUp) document.getElementById('main')?.scrollTo?.(0, 0);
  }, [tabletUp, key]);
  const close = () => void navigate('..');
  return tabletUp ? (
    // The backdrop click is a mouse shortcut; its keyboard equivalent is Escape (onCancel).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      className={s.cardWindow}
      aria-label={t('card.panel', { key })}
      data-testid="card-panel"
      onCancel={(e) => {
        e.preventDefault(); // Escape: leave by route so the URL follows
        close();
      }}
      onClick={(e) => {
        // A click on the dimmed backdrop lands on the <dialog> itself. Unsaved Details edits
        // ask first (ponytail: the form flags itself with data-dirty; other tabs' drafts don't).
        if (e.target !== e.currentTarget) return;
        if (ref.current?.querySelector('form[data-dirty]') && !confirm(t('card.discard'))) return;
        close();
      }}
    >
      <div className={s.detailPage}>
        <CardDetail key={key} cardKey={key} />
      </div>
    </dialog>
  ) : (
    <div className={s.detailPage} data-testid="card-page">
      <CardDetail key={key} cardKey={key} />
    </div>
  );
}

/** UX hint only: the server enforces D-012. */
/** Why a card cannot be written, or null when it can - the banner names the real reason. */
export function useWriteBlock(card: Card | undefined): null | 'team' | 'project' | 'closed' {
  const me = useContextData();
  // CR-12: a closed project's cards are read-only for everyone, admins included.
  const projects = useProjects({ includeClosed: true });
  if (!card) return 'team';
  if (
    card.projectId !== null &&
    (projects.data?.items ?? []).some((p) => p.id === card.projectId && p.closedAt !== null)
  )
    return 'project';
  // CR-24: so is a closed card, permanently - but its comments stay open, which a closed
  // project does not allow, hence 'project' is checked first.
  if (card.closedAt !== null) return 'closed';
  if (card.plane === 'private') return card.ownerId === me.user.id ? null : 'team';
  if (card.teamId === null) return null;
  return me.user.role === 'admin' || me.teams.some((tm) => tm.id === card.teamId) ? null : 'team';
}

export function useCanWrite(card: Card | undefined): boolean {
  return useWriteBlock(card) === null;
}

export function CardDetail({ cardKey }: { cardKey: string }) {
  const card = useCard(cardKey);
  const [tab, setTab] = useState<Tab>('details');
  const [copying, setCopying] = useState(false);
  const writeBlock = useWriteBlock(card.data);
  const canWrite = writeBlock === null;
  // CR-24: comments stay open on a closed card (the server still checks team write access).
  const canComment = canWrite || writeBlock === 'closed';
  if (card.isPending) return <Skeleton lines={6} label={t('card.loading')} />;
  // CR-28: another team's card says whose it is (the server's detail names the team).
  const limited = asProblem(card.error)?.code === 'OTHER_TEAM' ? asProblem(card.error) : undefined;
  if (card.isError || !card.data)
    return (
      <ErrorState
        heading="h1"
        title={limited ? t('card.otherTeam.title') : t('notFound.title')}
        body={limited ? problemBanner(limited) : t('card.notFound', { key: cardKey })}
        action={<Link to="/">{t('notFound.action')}</Link>}
      />
    );
  const c = card.data;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'details', label: t('card.tab.details') },
    { id: 'comments', label: t('card.tab.comments') },
    { id: 'links', label: t('card.tab.links') },
    { id: 'files', label: t('card.tab.files') },
    // D-116: time is logged on org cards only, so a private card has no Time tab.
    ...(c.plane === 'org' ? [{ id: 'time' as const, label: t('card.tab.time') }] : []),
    { id: 'history', label: t('card.tab.history') },
  ];
  return (
    <>
      <div className={s.detailHead}>
        <div>
          <span className={s.key}>{c.key}</span>{' '}
          <Pill tone={c.plane === 'private' ? 'muted' : 'accent'}>
            {t(c.plane === 'private' ? 'card.plane.private' : 'card.plane.org')}
          </Pill>
        </div>
        <div className={s.headActions}>
          <Button variant="secondary" onClick={() => setCopying(true)} data-testid="card-copy">
            {t(c.plane === 'private' ? 'card.copy.toOrg' : 'card.copy.toPrivate')}
          </Button>
          <Link
            to=".."
            className={s.close}
            aria-label={t('card.close')}
            title={t('card.close')}
            data-testid="card-close"
          >
            <Icon name="x" size={20} />
          </Link>
        </div>
      </div>
      {/* CR-18: full width below the actions; beside them a long title was squeezed to half. */}
      <h1 className={cx(pageTitleClass, s.detailTitle)} data-testid="card-title">
        {c.title}
      </h1>
      {!canWrite ? (
        <div data-testid="card-read-only">
          <Alert tone="info">
            {t(
              writeBlock === 'project'
                ? 'card.readOnlyProject'
                : writeBlock === 'closed'
                  ? 'card.readOnlyClosed'
                  : 'card.readOnly',
            )}
          </Alert>
        </div>
      ) : null}
      <div className={s.tabs} role="tablist" aria-label={t('card.tabs')}>
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            id={`tab-${tb.id}`}
            aria-selected={tab === tb.id}
            aria-controls={`panel-${tb.id}`}
            className={cx(s.tab, tab === tb.id && s.tabActive)}
            onClick={() => setTab(tb.id)}
            data-testid={`tab-${tb.id}`}
          >
            {tb.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className={s.tabPanel}
      >
        {tab === 'details' ? (
          <Details card={c} canWrite={canWrite} />
        ) : tab === 'comments' ? (
          <Comments card={c} canWrite={canComment} />
        ) : tab === 'links' ? (
          <Links card={c} canWrite={canWrite} />
        ) : tab === 'files' ? (
          <Files card={c} canWrite={canWrite} />
        ) : tab === 'time' ? (
          <Time card={c} canWrite={canWrite} />
        ) : (
          <History card={c} />
        )}
      </div>
      {copying ? <CopyDialog card={c} onClose={() => setCopying(false)} /> : null}
    </>
  );
}

function formOf(card: Card) {
  return {
    title: card.title,
    description: card.description,
    priority: card.priority,
    tags: card.tags,
    eta: card.eta ?? '',
    effortHours: card.effortHours === null ? '' : String(card.effortHours),
    teamId: card.teamId ?? '',
    projectId: card.projectId ?? '',
    assigneeId: card.assigneeId ?? '',
  };
}

function Details({ card, canWrite }: { card: Card; canWrite: boolean }) {
  const me = useContextData();
  const update = useUpdateCard(card.key);
  const move = useMoveCard();
  const navigate = useNavigate();
  const [form, setForm] = useState(() => formOf(card));
  // Re-seed the form when the server hands back a newer card (derived state, no effect).
  const [seenVersion, setSeenVersion] = useState(card.version);
  if (seenVersion !== card.version) {
    setSeenVersion(card.version);
    setForm(formOf(card));
  }
  const [banner, setBanner] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isOrg = card.plane === 'org';
  const team = useTeam(form.teamId);
  const projects = useProjects({
    ...(form.teamId ? { teamId: form.teamId } : {}),
    includeClosed: true,
  });
  const users = useUsers();
  // Team choices: the caller's teams plus the card's current team (may not be theirs).
  const teamOptions = [...me.teams];
  if (card.teamId && !teamOptions.some((tm) => tm.id === card.teamId) && team.data)
    teamOptions.push({ id: team.data.id, name: team.data.name });
  // CR-17: on a team card the assignee is a member of that team - plus any admin, who may hold
  // any org card so exceptions can be carried by someone. Team-less cards take anyone.
  // D-126: only people who have signed in can hold a card; invited ones wait for their first sign-in.
  const teamAssignees = [
    ...(team.data?.members ?? []).filter((m) => m.status === 'active'),
    ...(users.data?.items ?? []).filter(
      (u) => u.role === 'admin' && !(team.data?.members ?? []).some((m) => m.id === u.id),
    ),
  ];
  const assigneeOptions = form.teamId ? teamAssignees : (users.data?.items ?? []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBanner(null);
    setErrors({});
    try {
      await update.mutateAsync({
        version: card.version,
        title: form.title,
        description: form.description,
        priority: form.priority,
        tags: form.tags,
        eta: form.eta || null,
        effortHours: form.effortHours === '' ? null : Number(form.effortHours),
        ...(isOrg
          ? {
              teamId: form.teamId || null,
              projectId: form.projectId || null,
              assigneeId: form.assigneeId || null,
            }
          : {}),
      });
      // D-133: saving closes the card; the confirmation shows at the bottom of the board.
      void navigate('..', { state: { flash: t('card.savedKey', { key: card.key }) } });
    } catch (p) {
      const problem = p as Problem;
      setErrors(fieldErrorsOf(problem));
      setBanner({ tone: 'danger', text: problemBanner(problem) });
    }
  }

  async function onMove(state: CardState) {
    setBanner(null);
    try {
      await move.mutateAsync({ key: card.key, state, version: card.version });
    } catch (p) {
      setBanner({ tone: 'danger', text: problemBanner(p as Problem) });
    }
  }

  return (
    <form
      className={s.form}
      onSubmit={(e) => void onSubmit(e)}
      noValidate
      data-testid="card-form"
      data-dirty={JSON.stringify(form) !== JSON.stringify(formOf(card)) ? '' : undefined}
    >
      <fieldset className={s.fieldset} disabled={!canWrite}>
        <label className={s.field}>
          <span>{t('card.state')}</span>
          <select
            className={s.input}
            value={card.state}
            onChange={(e) => void onMove(e.target.value as CardState)}
            disabled={!card.canMove} // D-117: only the person working on it moves it
            title={card.canMove ? undefined : t('card.moveNotYours')}
            data-testid="detail-state"
          >
            {STATES.map((o) => (
              <option key={o} value={o}>
                {t(STATE_LABEL[o])}
              </option>
            ))}
          </select>
        </label>
        <label className={s.field}>
          <span>{t('card.titleField')}</span>
          <input
            className={cx(s.input, errors['title'] && s.invalid)}
            required
            maxLength={200}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            data-testid="detail-title"
          />
          {errors['title'] ? <span className={s.fieldError}>{errors['title']}</span> : null}
        </label>
        <label className={s.field}>
          <span>{t('card.description')}</span>
          <textarea
            className={cx(s.input, s.textarea)}
            rows={6}
            maxLength={20000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            data-testid="detail-description"
          />
          <span className={s.hint}>{t('card.markdownHint')}</span>
        </label>
        {form.description.trim() ? (
          <div className={s.preview} data-testid="detail-preview">
            <Markdown text={form.description} />
          </div>
        ) : null}
        {isOrg ? (
          <div className={s.row}>
            <label className={s.field}>
              <span>{t('card.team')}</span>
              <select
                className={cx(s.input, errors['teamId'] && s.invalid)}
                value={form.teamId}
                onChange={(e) =>
                  setForm({ ...form, teamId: e.target.value, projectId: '', assigneeId: '' })
                }
                data-testid="detail-team"
              >
                {/* CR-22: a team cannot be taken off an org card; the blank only names a legacy one. */}
                {card.teamId === null ? <option value="">{t('card.noTeam')}</option> : null}
                {teamOptions.map((tm) => (
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
                className={cx(s.input, errors['projectId'] && s.invalid)}
                value={form.projectId}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                disabled={!form.teamId}
                data-testid="detail-project"
              >
                <option value="">{t('card.noProject')}</option>
                {(projects.data?.items ?? [])
                  // CR-12: a stopped or closed project takes no new cards, but the one this card
                  // is already in must stay selectable or saving would silently move it out.
                  .filter((p) => p.id === card.projectId || (p.accepting && !p.closedAt))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.id === card.projectId && (p.closedAt || !p.accepting)
                        ? ` (${t(p.closedAt ? 'projects.closed' : 'projects.stopped')})`
                        : ''}
                    </option>
                  ))}
              </select>
              {errors['projectId'] ? (
                <span className={s.fieldError}>{errors['projectId']}</span>
              ) : null}
            </label>
            <label className={s.field}>
              <span>{t('card.assignee')}</span>
              <select
                className={cx(s.input, errors['assigneeId'] && s.invalid)}
                value={form.assigneeId}
                onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
                data-testid="detail-assignee"
              >
                <option value="">{t('card.unassigned')}</option>
                {assigneeOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
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
              data-testid="detail-priority"
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
              data-testid="detail-eta"
            />
          </label>
          <label className={s.field}>
            <span>{t('card.effort')}</span>
            <input
              className={cx(s.input, errors['effortHours'] && s.invalid)}
              type="number"
              min={0}
              step={0.25}
              inputMode="decimal"
              value={form.effortHours}
              onChange={(e) => setForm({ ...form, effortHours: e.target.value })}
              data-testid="detail-effort"
            />
          </label>
        </div>
        <div className={s.field}>
          <span className={s.hint}>{t('card.logged', { n: String(card.loggedHours) })}</span>
          <FieldHistory card={card} field="eta" />
          <FieldHistory card={card} field="effort" />
        </div>
        <div className={s.field}>
          <span>{t('card.tags')}</span>
          <TagPicker
            value={form.tags}
            onChange={(tags) => setForm({ ...form, tags })}
            disabled={!canWrite}
            testId="detail-tags"
          />
          {errors['tags'] ? <span className={s.fieldError}>{errors['tags']}</span> : null}
        </div>
      </fieldset>
      {/* D-133: next to Save, where the eye is when it is pressed. */}
      {banner ? (
        <div data-testid={banner.tone === 'danger' ? 'card-error' : 'card-saved'}>
          <Alert tone={banner.tone}>{banner.text}</Alert>
        </div>
      ) : null}
      <div className={s.actions}>
        <Button
          type="submit"
          variant="primary"
          busy={update.isPending}
          busyLabel={t('card.saving')}
          disabled={!canWrite}
        >
          {t('card.save')}
        </Button>
        <Button variant="ghost" onClick={() => void navigate('..')}>
          {t('card.close')}
        </Button>
        <span className={s.hint}>{t('card.version', { n: String(card.version) })}</span>
      </div>
    </form>
  );
}

const FIELD_FILTERS = ['', 'state', 'eta', 'effort', 'team', 'project', 'assignee'] as const;

function History({ card }: { card: Card }) {
  const names = useEventNames();
  const [field, setField] = useState<string>('');
  const events = useCardEvents(card.key, field || undefined);
  return (
    <div className={s.history} data-testid="history">
      <label className={s.field}>
        <span>{t('card.historyFilter')}</span>
        <select
          className={s.input}
          value={field}
          onChange={(e) => setField(e.target.value)}
          data-testid="history-filter"
        >
          {FIELD_FILTERS.map((f) => (
            <option key={f} value={f}>
              {f ? eventLabel(f) : t('card.allEvents')}
            </option>
          ))}
        </select>
      </label>
      {events.isPending ? (
        <Skeleton lines={4} label={t('card.loading')} />
      ) : (
        <ol className={s.eventList}>
          {(events.data?.items ?? []).map((ev) => (
            <li key={ev.id} className={s.event} data-testid="event">
              <div className={s.commentHead}>
                <Pill tone={ev.field === 'created' ? 'success' : 'muted'}>
                  {eventLabel(ev.field)}
                </Pill>
                <span className={s.hint}>
                  {`${ev.actor.name} - ${when(ev.createdAt)}`}
                  {ev.copiedFromKey ? ` ${t('card.copiedFrom', { key: ev.copiedFromKey })}` : ''}
                </span>
              </div>
              {ev.limitedTeam ? (
                <p className={s.hint} data-testid="event-other-team">
                  {t('card.otherTeam', { team: ev.limitedTeam })}
                </p>
              ) : null}
              {ev.field !== 'created' ? (
                <Change old={ev.oldValue} now={ev.newValue} names={names} field={ev.field} />
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** What changed: "old > new"; an addition shows only the new value, a removal only the old. */
export function Change({
  old,
  now,
  names,
  field,
}: {
  old: unknown;
  now: unknown;
  names?: Map<string, string>;
  /** D-158: a state change shows the states' names, the new one as a pill. */
  field?: string;
}) {
  const none = (v: unknown) => v === null || v === undefined;
  const state = field === 'state';
  const label = (v: unknown) =>
    state && typeof v === 'string' && v in STATE_LABEL
      ? t(STATE_LABEL[v as CardState])
      : show(v, names);
  return (
    <div className={s.diff}>
      {none(old) ? null : <span className={s.old}>{label(old)}</span>}
      {none(old) || none(now) ? null : <Icon name="arrow" size={16} />}
      {none(now) ? null : <span className={state ? s.newState : undefined}>{label(now)}</span>}
    </div>
  );
}

export function eventLabel(field: string): string {
  return t(`event.${field}` as 'event.state');
}

/** id -> name for the people and projects an older event may have stored as a bare id. */
export function useEventNames(): Map<string, string> {
  const users = useUsers();
  const projects = useProjects({ includeClosed: true });
  const m = new Map<string, string>();
  for (const u of users.data?.items ?? []) m.set(u.id, u.name);
  for (const p of projects.data?.items ?? []) m.set(p.id, p.name);
  return m;
}

/** A bare ULID - the shape ids take here. Never show one to a person (FR-074). */
const ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Render an event value. `names` resolves ids that older events stored bare, before the writers
 * were changed to carry `{id, name}`; an id that resolves to nothing shows as "someone" rather
 * than as a raw ULID, because a GUID on screen tells a person nothing.
 */
const ON_DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const AT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** When an event happened, e.g. "8 Oct 2026, 14:26" (the reader's own clock). */
export function when(iso: string): string {
  return AT.format(new Date(iso));
}

export function show(v: unknown, names?: Map<string, string>): string {
  if (v === null || v === undefined) return t('card.none');
  if (typeof v === 'string') return ID_RE.test(v) ? (names?.get(v) ?? t('card.someone')) : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => show(x, names)).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('body' in o) return String(o['body']);
    // A time entry (time_logged / _edited / _deleted): "3 h on Thu 8 Oct 2026".
    if ('hours' in o && 'date' in o)
      return t('history.timeEntry', {
        hours: String(o['hours']),
        date: ON_DAY.format(new Date(`${String(o['date'])}T00:00:00Z`)),
      });
    if ('name' in o) return String(o['name']);
    if ('otherKey' in o) return `${String(o['type'])} ${String(o['otherKey'])}`;
    if ('key' in o) return String(o['key']);
  }
  return JSON.stringify(v);
}
