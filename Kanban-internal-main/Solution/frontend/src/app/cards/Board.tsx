// Boards (FR-050..054): private, team and Unassigned share one component. D-150: the board look
// of the user's mockup - Board / Backlog / Calendar tabs, a one-row filter bar with a Filters
// popover, a "+" per column, and a card face of title + priority, tags, then date, key, person
// and a "..." menu holding Move to. Columns = states,
// order from the server, filter chips, drag between columns (HTML5 DnD) and a keyboard
// "move to" select on every card (NFR-007). Team boards add project/assignee filters and a
// client-side "group by project" swimlane toggle (D-025); the Unassigned board adds the CR-17
// mode filter. Claim (FR-018, CR-23 = PATCH assigneeId = me) sits on any unheld open card of my
// team, on the team and Unassigned boards. Mobile (< 640): one column at a
// time with a column switcher. Every card carries a person (CR-20): the assignee, or the
// owner marked "raised by" when nobody is holding it.
import { useState, type DragEvent } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { Alert, Button, EmptyState, Pill, Skeleton } from '../../components';
import { Avatar } from '../../components/Avatar';
import { MQ, useMediaQuery } from '../../components/useMediaQuery';
import { t, type MessageKey } from '../../i18n/t';
import { asProblem, problemBanner, problemMessage, type Problem } from '../../api/client';
import { cx } from '../../styles/cx';
import { formatDate, formatDayMonth } from '../../styles/format';
import { pageTitleClass } from '../Shell';
import { useContextData } from '../auth/useMe';
import { usePrograms, useProjects, useTags, useTeam, useUsers } from '../org/api';
import {
  STATES,
  useBoard,
  useMoveCard,
  usePatchCard,
  type BoardScope,
  type Card,
  type CardState,
} from './api';
import { PlaneSwitch, rememberedPlane, Segmented } from './PlaneSwitch';
import { projectStyle, tagStyle } from './projectColor';
import { NewCardDialog } from './NewCardDialog';
import { BoardCalendar } from './Calendar';
import { BacklogTable } from './Backlog';
import { Icon } from '../../components/Icon';
import { usePreferences } from '../auth/useMe';
import s from './cards.module.css';

export const STATE_LABEL: Record<CardState, MessageKey> = {
  backlog: 'state.backlog',
  in_prep: 'state.in_prep',
  ready: 'state.ready',
  in_development: 'state.in_development',
  uat: 'state.uat',
  delivered: 'state.delivered',
  cancelled: 'state.cancelled',
};

/** D-136: the columns whose size caps the Delivered column. */
const WORKING_STATES: CardState[] = ['in_prep', 'ready', 'in_development', 'uat'];

const PRIORITY_TONE = { 1: 'danger', 2: 'warning', 3: 'muted', 4: 'muted' } as const;

/** D-134: a card may have no priority - then there is no pill. */
export function PriorityPill({ priority }: { priority: number | null }) {
  if (priority === null) return null;
  return (
    <Pill
      tone={PRIORITY_TONE[priority as 1 | 2 | 3 | 4] ?? 'muted'}
      title={t(`card.priorityTip.${priority}` as 'card.priorityTip.1')}
    >
      {t('card.priorityShort', { n: String(priority) })}
    </Pill>
  );
}

/**
 * D-143 (replaces CR-20's raised-by owner): only the assignee shows on a card - an unassigned
 * card shows nobody, so the creator's picture is not mistaken for the holder. Their picture,
 * else their name in small type, cut short with an ellipsis so it never leaves the card. The
 * tooltip carries the full name.
 */
function Person({
  user,
}: {
  user: { id: string; name: string; photoUpdatedAt?: string | null } | undefined;
}) {
  if (!user) return null;
  // D-150: the picture, else initials (replaces D-143's name in small type); the name is in
  // the tooltip and the accessible name.
  const tip = t('card.assigneeTip', { name: user.name });
  return (
    <span className={s.person} title={tip} role="img" aria-label={tip} data-testid="card-assignee">
      <Avatar user={user} size={26} />
    </span>
  );
}

/** Cards per project on the board, most first. */
function projectCounts(columns: Record<string, Card[]> | undefined): [string, number][] {
  const n = new Map<string, number>();
  for (const c of Object.values(columns ?? {}).flat())
    if (c.projectId) n.set(c.projectId, (n.get(c.projectId) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]);
}

const LEGEND_SHOWN = 4;

/**
 * The project colour key, on one line (D-119): the busiest projects first with their card
 * count, the rest behind "+N more". Each chip filters the board to that project.
 */
function ProjectLegend({
  counts,
  names,
  active,
  onPick,
}: {
  counts: [string, number][];
  names: Map<string, string>;
  active: string;
  onPick: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const wide = useMediaQuery(MQ.tabletUp);
  if (counts.length === 0) return null;
  const shown = all ? counts : counts.slice(0, wide ? LEGEND_SHOWN : 2);
  const hidden = counts.length - shown.length;
  return (
    <div
      className={cx(s.legend, all && s.legendAll)}
      role="group"
      aria-label={t('board.legend')}
      data-testid="project-legend"
    >
      <span className={s.legendLabel}>{t('board.legendLabel')}</span>
      {shown.map(([id, n]) => {
        const name = names.get(id) ?? '…';
        return (
          <button
            key={id}
            type="button"
            className={cx(s.projectPill, s.legendChip, active === id && s.legendOn)}
            style={projectStyle(id)}
            aria-pressed={active === id}
            title={t('board.legendTip', { name, n: String(n) })}
            onClick={() => onPick(id)}
          >
            <span className={s.legendName}>{name}</span>
            <span className={s.legendCount}>{n}</span>
          </button>
        );
      })}
      {hidden > 0 || all ? (
        <button
          type="button"
          className={s.legendMore}
          aria-expanded={all}
          onClick={() => setAll(!all)}
          data-testid="legend-more"
        >
          {all ? t('board.legendLess') : t('board.legendMore', { n: String(hidden) })}
        </button>
      ) : null}
    </div>
  );
}

export function PrivateBoard() {
  // D-149: My board (/) opens on the plane picked last; Private is pressed to come back here.
  const me = useContextData();
  const { pathname } = useLocation();
  if (pathname === '/' && rememberedPlane(me.user.id) === 'org')
    return <Navigate to="/org" replace />;
  return <Board scope={{ kind: 'private' }} />;
}
/** My board > Org tab (D-059). */
export function MyOrgBoard() {
  return <Board key="mine" scope={{ kind: 'mine' }} />;
}
export function UnassignedBoard() {
  return <Board scope={{ kind: 'unassigned' }} />;
}
export function TeamBoard() {
  const { teamId = '' } = useParams();
  return <Board key={teamId} scope={{ kind: 'team', teamId }} />;
}

const NO_PROJECT = '__none__';

const BOARD_STATES: CardState[] = STATES.filter((st) => st !== 'backlog');

export function Board({ scope }: { scope: BoardScope }) {
  // Backlog tab (D-067): /…/backlog shows the Backlog column as a list; the Board tab the rest;
  // D-150: /…/calendar shows the same cards on their ETA dates.
  const { pathname } = useLocation();
  const backlogTab = /\/backlog(\/|$)/.test(pathname);
  const calendarTab = !backlogTab && /\/calendar(\/|$)/.test(pathname);
  const base = pathname.replace(/\/(backlog|calendar)(\/.*)?$/, '').replace(/\/cards\/K-\d+$/, '');
  const boardTo = base || '/';
  const tabTo = (tab: string) => (base === '/' || base === '' ? `/${tab}` : `${base}/${tab}`);
  const backlogTo = tabTo('backlog');
  // Card routes are nested under the tab, so hrefs are built from the tab path, not route-relative.
  // A card opened from the calendar opens over the Board tab.
  const cardHref = (key: string) =>
    `${(backlogTab ? backlogTo : boardTo).replace(/\/$/, '')}/cards/${key}`;
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [priority, setPriority] = useState(0);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false); // D-089: Cancelled column hidden by default
  const [projectId, setProjectId] = useState('');
  const [programId, setProgramId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [groupByProject, setGroupByProject] = useState(false);
  const [column, setColumn] = useState<CardState>('in_prep');
  // D-150: the column whose "+" was pressed; the new card starts in that state.
  const [adding, setAdding] = useState<CardState | null>(null);
  // CR-17: which sense of "unassigned" the board is showing.
  const [mode, setMode] = useState<'all' | 'no_team'>('all');
  const [error, setError] = useState<string | null>(null);
  const tabletUp = useMediaQuery(MQ.tabletUp);
  const navigate = useNavigate();
  const me = useContextData();
  const isTeam = scope.kind === 'team';
  const teamId = isTeam ? scope.teamId : '';
  const team = useTeam(teamId);
  // CR-12: closed projects stay in the lookup so a still-visible card of one keeps its name;
  // the filter list below hides them unless the board is showing closed cards anyway.
  const projects = useProjects({ ...(isTeam ? { teamId } : {}), includeClosed: true });
  const programs = usePrograms();
  const tags = useTags();
  const users = useUsers();
  const prefs = usePreferences(scope.kind === 'mine');
  const board = useBoard(scope, {
    q,
    tag,
    priority,
    includeClosed,
    projectId,
    programId,
    assigneeId,
    ...(scope.kind === 'unassigned' ? { mode } : {}),
  });
  const move = useMoveCard();
  const patch = usePatchCard();

  const isMine = scope.kind === 'private' || scope.kind === 'mine';
  const title = isMine
    ? t('board.title')
    : scope.kind === 'unassigned'
      ? t('board.unassigned')
      : t('board.team', { name: team.data?.name ?? '' });
  // UX hint only; the server decides (D-012, D-060: admins may write any org card).
  const canCreate =
    scope.kind !== 'team' || team.data?.isMember === true || me.user.role === 'admin';
  const projectName = new Map((projects.data?.items ?? []).map((p) => [p.id, p.name]));
  const projectInfo = new Map(
    (projects.data?.items ?? []).map((p) => [
      p.id,
      { name: p.name, program: p.program?.name ?? null },
    ]),
  );
  const userById = new Map((users.data?.items ?? []).map((u) => [u.id, u]));

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      return true;
    } catch (p) {
      setError(problemMessage(p as Problem));
      return false;
    }
  }

  function moveTo(card: Card, state: CardState) {
    if (state === card.state) return;
    void run(() => move.mutateAsync({ key: card.key, state, version: card.version }));
  }

  function onDrop(state: CardState) {
    return (e: DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/x-card');
      if (!raw) return;
      moveTo(JSON.parse(raw) as Card, state);
    };
  }

  // D-078: the dialog fills team/project from the board and the person's defaults; the board
  // adds what must hold for the card to land here: the state of the column whose "+" was
  // pressed (D-150; the server still checks it).
  const newCardCtx = {
    plane: scope.kind === 'private' ? ('private' as const) : ('org' as const),
    ...(scope.kind === 'team' ? { fixedTeamId: scope.teamId } : {}),
    ...(projectId ? { filterProjectId: projectId } : {}),
    // CR-17: the server assigns a new card to its creator, so the Org tab no longer needs to.
    extra: { state: adding ?? ('in_prep' as const) },
  };
  // D-150: the ticks live behind the Filters button; its badge counts the ones switched on.
  const ticked = [includeClosed, showCancelled && !backlogTab, isTeam && groupByProject].filter(
    Boolean,
  ).length;

  // CR-23: Claim = "I'll take this". Valid holders are the card's team members and admins
  // (D-049, CR-17); a legacy team-less card gets its team on the card page instead.
  const canClaim = (card: Card) =>
    scope.kind !== 'private' &&
    card.plane === 'org' &&
    card.assigneeId === null &&
    card.closedAt === null &&
    card.teamId !== null &&
    (me.user.role === 'admin' || me.teams.some((tm) => tm.id === card.teamId));
  function claim(card: Card) {
    void run(() =>
      patch.mutateAsync({ key: card.key, body: { version: card.version, assigneeId: me.user.id } }),
    );
  }

  const columns = board.data?.columns;
  const boardStates = showCancelled
    ? BOARD_STATES
    : BOARD_STATES.filter((st) => st !== 'cancelled');
  const visible: CardState[] = backlogTab ? ['backlog'] : tabletUp ? boardStates : [column];
  // Swimlanes are a client-side regrouping of the same server-ordered columns (D-025).
  const lanes: { id: string; label: string }[] =
    isTeam && groupByProject && columns
      ? [
          ...new Set(
            Object.values(columns)
              .flat()
              .map((c) => c.projectId ?? NO_PROJECT),
          ),
        ]
          .sort((a, b) =>
            a === NO_PROJECT
              ? 1
              : b === NO_PROJECT
                ? -1
                : (projectName.get(a) ?? a).localeCompare(projectName.get(b) ?? b),
          )
          .map((id) => ({
            id,
            label: id === NO_PROJECT ? t('board.noProject') : (projectName.get(id) ?? id),
          }))
      : [{ id: '', label: '' }];

  const renderCard = (card: Card) => (
    <li
      key={card.id}
      className={cx(s.card, !card.canMove && s.cardFixed)}
      draggable={card.canMove} // D-117: the server says who may move it (closed: nobody)
      onDragStart={(e) => e.dataTransfer.setData('application/x-card', JSON.stringify(card))}
      data-testid={`card-${card.key}`}
      style={projectStyle(card.projectId)}
    >
      {/* Card face (D-150): title and priority, the pills, then date, key, person and the "..."
          menu - Move to sits in it for keyboard and touch users, since dragging alone is not
          enough; Claim stays on the face. */}
      <div className={s.cardTop}>
        <Link to={cardHref(card.key)} className={s.cardLink}>
          <span className={s.cardTitle}>{card.title}</span>
        </Link>
        <PriorityPill priority={card.priority} />
      </div>
      {card.tags.length > 0 || (card.projectId && !groupByProject) ? (
        <div className={s.meta}>
          {card.tags.map((tg) => (
            <span
              key={tg}
              className={s.tagPill}
              style={tagStyle(tg)}
              title={t('card.tagTip', { tag: tg })}
            >
              {tg}
            </span>
          ))}
          {card.projectId && !groupByProject ? (
            <span
              className={s.projectPill}
              style={projectStyle(card.projectId)}
              title={t('card.projectTip', { name: projectName.get(card.projectId) ?? '' })}
              data-testid="project-pill"
            >
              {projectName.get(card.projectId) ?? t('card.project')}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={s.cardFoot}>
        {card.eta ? (
          <span className={s.eta} title={t('card.etaTip', { date: formatDate(card.eta) })}>
            <Icon name="cal" size={14} />
            {formatDayMonth(card.eta)}
          </span>
        ) : null}
        <span className={s.key}>
          <Icon name="bookmark" size={14} />
          <span className={s.keyText}>{card.key}</span>
        </span>
        <span className={s.footEnd}>
          <Person user={card.assigneeId ? userById.get(card.assigneeId) : undefined} />
          <details className={s.cardMenu} data-popover data-testid={`menu-${card.key}`}>
            <summary
              className={s.cardMenuButton}
              aria-label={t('card.actions', { key: card.key })}
              title={t('card.actions', { key: card.key })}
            >
              <Icon name="more" size={18} />
            </summary>
            <div className={s.cardMenuPanel}>
              <label className={s.moveLabel}>
                <span className={s.menuLabel}>{t('card.moveTo', { key: card.key })}</span>
                <select
                  className={s.moveSelect}
                  value={card.state}
                  onChange={(e) => {
                    e.currentTarget.closest('details')?.removeAttribute('open');
                    moveTo(card, e.target.value as CardState);
                  }}
                  disabled={!card.canMove} // D-117 / CR-24: assignee, lead or admin; never closed
                  title={card.canMove ? undefined : t('card.moveNotYours')}
                  data-testid={`move-${card.key}`}
                >
                  {STATES.map((o) => (
                    <option key={o} value={o}>
                      {t(STATE_LABEL[o])}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </span>
      </div>
      {canClaim(card) ? (
        <Button
          variant="secondary"
          onClick={() => claim(card)}
          busy={patch.isPending && patch.variables?.key === card.key}
          data-testid={`claim-${card.key}`}
        >
          {t('board.claim')}
        </Button>
      ) : null}
    </li>
  );

  return (
    <div className={s.page} data-testid="board">
      <div className={s.head}>
        <div className={s.titleBlock}>
          <h1 className={pageTitleClass}>{title}</h1>
          <p className={s.subtitle}>{t('board.subtitle')}</p>
        </div>
        {isMine ? <PlaneSwitch userId={me.user.id} /> : null}
        <span className={s.headGap} />
        <Segmented
          label={t('board.tabs')}
          items={[
            {
              to: boardTo,
              label: t('board.tab.board'),
              icon: 'board',
              active: !backlogTab && !calendarTab,
            },
            { to: backlogTo, label: t('board.tab.backlog'), icon: 'list', active: backlogTab },
            {
              to: tabTo('calendar'),
              label: t('board.tab.calendar'),
              icon: 'cal',
              active: calendarTab,
            },
          ]}
          testId="backlog-switch"
        />
        {canCreate ? null : (
          <span className={s.hint} data-testid="read-only-note">
            {t('board.readOnly')}
          </span>
        )}
      </div>

      <div className={s.filters} role="group" aria-label={t('board.filters')}>
        <input
          className={s.input}
          type="search"
          aria-label={t('board.search')}
          placeholder={t('board.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="filter-q"
        />
        <select
          className={s.input}
          aria-label={t('board.tag')}
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          data-testid="filter-tag"
        >
          <option value="">{t('board.anyTag')}</option>
          {(tags.data?.items ?? []).map((tg) => (
            <option key={tg.id} value={tg.name}>
              {tg.name}
            </option>
          ))}
        </select>
        <select
          className={s.input}
          aria-label={t('board.priority')}
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
          data-testid="filter-priority"
        >
          <option value={0}>{t('board.anyPriority')}</option>
          {[1, 2, 3, 4].map((p) => (
            <option key={p} value={p}>
              {t('card.priorityShort', { n: String(p) })}
            </option>
          ))}
        </select>
        {isTeam || scope.kind === 'mine' ? (
          <>
            <select
              className={s.input}
              aria-label={t('board.program')}
              value={programId}
              onChange={(e) => {
                setProgramId(e.target.value);
                setProjectId('');
              }}
              data-testid="filter-program"
            >
              <option value="">{t('board.anyProgram')}</option>
              {(programs.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className={s.input}
              aria-label={t('board.project')}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              data-testid="filter-project"
            >
              <option value="">{t('board.anyProject')}</option>
              {(projects.data?.items ?? [])
                .filter((p) => !p.closedAt || includeClosed)
                .filter((p) => !programId || p.program?.id === programId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {isTeam ? p.name : `${p.team.name} / ${p.name}`}
                  </option>
                ))}
            </select>
          </>
        ) : null}
        {!isMine ? (
          <select
            className={s.input}
            aria-label={t('board.assignee')}
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            data-testid="filter-assignee"
          >
            <option value="">{t('board.anyAssignee')}</option>
            {(isTeam ? (team.data?.members ?? []) : (users.data?.items ?? [])).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        ) : null}
        {scope.kind === 'unassigned' ? (
          <select
            className={s.input}
            aria-label={t('board.unassignedMode')}
            value={mode}
            onChange={(e) => setMode(e.target.value as 'all' | 'no_team')}
            data-testid="filter-mode"
          >
            <option value="all">{t('board.modeAll')}</option>
            <option value="no_team">{t('board.modeNoTeam')}</option>
          </select>
        ) : null}
        {!tabletUp && !backlogTab && !calendarTab ? (
          <select
            className={s.input}
            aria-label={t('board.column')}
            value={column}
            onChange={(e) => setColumn(e.target.value as CardState)}
            data-testid="column-switcher"
          >
            {boardStates.map((st) => (
              <option key={st} value={st}>
                {`${t(STATE_LABEL[st])} (${columns?.[st].length ?? 0})`}
              </option>
            ))}
          </select>
        ) : null}
        {/* D-150: the ticks sit behind one Filters button (CR-18's group, folded away). */}
        <details className={s.filterMenu} data-popover data-testid="filters-menu">
          <summary className={s.filterButton} data-testid="filters-open">
            <Icon name="filter" size={18} />
            {t('board.filtersButton')}
            {ticked > 0 ? (
              <span className={s.filterCount} aria-label={t('board.filtersOn', { n: ticked })}>
                {ticked}
              </span>
            ) : null}
          </summary>
          <div className={s.filterPanel}>
            {isTeam ? (
              <label className={s.check}>
                <input
                  type="checkbox"
                  checked={groupByProject}
                  onChange={(e) => setGroupByProject(e.target.checked)}
                  data-testid="filter-group"
                />
                {t('board.groupByProject')}
              </label>
            ) : null}
            <label className={s.check}>
              <input
                type="checkbox"
                checked={includeClosed}
                onChange={(e) => setIncludeClosed(e.target.checked)}
                data-testid="filter-closed"
              />
              {t('board.showClosed')}
            </label>
            {!backlogTab ? (
              <label className={s.check}>
                <input
                  type="checkbox"
                  checked={showCancelled}
                  onChange={(e) => setShowCancelled(e.target.checked)}
                  data-testid="filter-cancelled"
                />
                {t('board.showCancelled')}
              </label>
            ) : null}
          </div>
        </details>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {(!isMine || scope.kind === 'mine') && !backlogTab ? (
        <ProjectLegend
          counts={projectCounts(columns)}
          names={projectName}
          active={projectId}
          onPick={(id) => setProjectId(projectId === id ? '' : id)}
        />
      ) : null}

      {board.isPending ? (
        <Skeleton lines={6} label={t('board.loading')} />
      ) : asProblem(board.error)?.code === 'OTHER_TEAM' ? (
        // CR-28: another team's board says whose it is; retrying would not help
        <Alert tone="danger">{problemBanner(asProblem(board.error))}</Alert>
      ) : board.isError || !columns ? (
        <Alert
          tone="danger"
          action={<Button onClick={() => void board.refetch()}>{t('error.action')}</Button>}
        >
          {t('error.body')}
        </Alert>
      ) : backlogTab ? (
        <BacklogTable
          cards={columns.backlog}
          cardHref={cardHref}
          projects={projectInfo}
          users={userById}
          canCreate={canCreate}
          onAdd={() => setAdding('backlog')}
          meId={me.user.id}
        />
      ) : calendarTab ? (
        <BoardCalendar
          cards={Object.entries(columns)
            .filter(([st]) => showCancelled || st !== 'cancelled')
            .flatMap(([, cards]) => cards)}
          cardHref={cardHref}
        />
      ) : (
        lanes.map((lane) => (
          <section
            key={lane.id}
            className={s.lane}
            aria-label={lane.label || undefined}
            data-testid={lane.id ? `lane-${lane.id}` : undefined}
          >
            {lane.label ? <h2 className={s.laneTitle}>{lane.label}</h2> : null}
            <div
              className={cx(s.columns, (!tabletUp || backlogTab) && s.single)}
              data-testid="columns"
            >
              {visible.map((st) => {
                const all = lane.id
                  ? columns[st].filter((c) => (c.projectId ?? NO_PROJECT) === lane.id)
                  : columns[st];
                // D-077: on the Org tab the default entities' cards form the first band.
                const pt = prefs.data?.primaryTeamId ?? null;
                const pp = prefs.data?.primaryProjectId ?? null;
                const rank = (c: Card) => {
                  const teamHit = pt !== null && c.teamId === pt ? 1 : 0;
                  const projHit = pp !== null && c.projectId === pp ? 1 : 0;
                  return prefs.data?.orgOrder === 'project_first'
                    ? projHit * 2 + teamHit
                    : teamHit * 2 + projHit;
                };
                const banded = scope.kind === 'mine' && (pt !== null || pp !== null);
                const sorted = banded ? [...all].sort((a, b) => rank(b) - rank(a)) : all;
                // D-136: Delivered shows no more cards than the fullest working column; "Show
                // closed" shows them all, so finished work does not swamp the board.
                const inLane = (state: CardState) =>
                  lane.id
                    ? columns[state].filter((c) => (c.projectId ?? NO_PROJECT) === lane.id).length
                    : columns[state].length;
                const cap = Math.max(...WORKING_STATES.map(inLane));
                const capped =
                  st === 'delivered' && !backlogTab && !includeClosed && sorted.length > cap;
                const cards = capped ? sorted.slice(0, cap) : sorted;
                const hiddenCount = sorted.length - cards.length;
                const firstOther = banded ? cards.findIndex((c) => rank(c) === 0) : -1;
                const H = lane.label ? 'h3' : 'h2';
                return (
                  <section
                    key={st}
                    className={cx(s.column, backlogTab && tabletUp && s.columnPlain)}
                    data-state={st}
                    aria-labelledby={`col-${lane.id}-${st}`}
                    data-testid={`column-${st}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={onDrop(st)}
                  >
                    <div className={s.columnHead}>
                      <H id={`col-${lane.id}-${st}`} className={s.columnTitle}>
                        {t(STATE_LABEL[st])}{' '}
                        <span
                          className={s.count}
                          title={t('board.countTip', {
                            n: String(sorted.length),
                            state: t(STATE_LABEL[st]),
                          })}
                        >
                          {sorted.length}
                        </span>
                      </H>
                      {canCreate && st !== 'delivered' && st !== 'cancelled' ? (
                        <button
                          type="button"
                          className={s.columnAdd}
                          onClick={() => setAdding(st)}
                          aria-label={t('board.createIn', { state: t(STATE_LABEL[st]) })}
                          title={t('board.createIn', { state: t(STATE_LABEL[st]) })}
                          data-testid={`column-add-${st}`}
                        >
                          <Icon name="plus" size={18} />
                        </button>
                      ) : null}
                    </div>
                    <ul className={cx(s.cards, backlogTab && tabletUp && s.cardsGrid)}>
                      {cards.length === 0 && hiddenCount === 0 ? (
                        <li className={s.emptyCol}>{t('board.emptyColumn')}</li>
                      ) : (
                        cards.flatMap((card, i) =>
                          banded && i === firstOther && i > 0
                            ? [
                                <li
                                  key="divider"
                                  className={s.bandDivider}
                                  data-testid="band-divider"
                                >
                                  {t('board.others')}
                                </li>,
                                renderCard(card),
                              ]
                            : [renderCard(card)],
                        )
                      )}
                    </ul>
                    {hiddenCount > 0 ? (
                      <p className={s.hint} data-testid="delivered-more">
                        {t('board.moreDelivered', { n: String(hiddenCount) })}
                      </p>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </section>
        ))
      )}
      {board.data && Object.values(columns ?? {}).every((c) => c.length === 0) ? (
        <EmptyState
          title={t('board.empty.title')}
          body={canCreate ? t('board.empty.body') : t('board.empty.bodyReadOnly')}
        />
      ) : null}
      {adding ? (
        <NewCardDialog
          ctx={newCardCtx}
          onClose={() => setAdding(null)}
          onCreated={(key) => void navigate(cardHref(key))}
        />
      ) : null}
      <Outlet context={me} />
    </div>
  );
}
