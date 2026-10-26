// Inbox (FR-044 / D-066): what changed on my cards and in my teams. CR-15 filters it by team,
// project and "assigned to me" and drops the reason ranking - the list is newest-first and the
// reason is only a badge. CR-16 groups it by what changed, each group carrying the true total for
// the whole filtered set and paging inside itself. CR-19 marks an entry read when it is opened,
// and clears by date. D-158 (the user's mockup): the groups are tabs (All first), the list is
// split into Today / Last 7 days / Earlier, each row has an icon for its kind, the change on one
// line (old value not struck through) and a "..." menu; Mentions is a group of its own. No rules
// here: every count and filter comes from the server.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Alert, Button, EmptyState, Pill, Skeleton } from '../../components';
import { Icon, type IconName } from '../../components/Icon';
import { t } from '../../i18n/t';
import { cx } from '../../styles/cx';
import { ME_KEY } from '../auth/useMe';
import { useProjects, useTeams } from '../org/api';
import { pageTitleClass } from '../Shell';
import {
  useClearInbox,
  useInbox,
  useMarkInboxRead,
  useMarkInboxSeen,
  type InboxFilter,
  type InboxGroup,
  type InboxItem,
} from './api';
import { Change, eventLabel, useEventNames, when } from './CardDetail';
import s from './cards.module.css';

/** Tab order; `other` is the catch-all and always sits last. Matches the contract enum. */
const GROUPS: InboxGroup[] = [
  'assignments',
  'mentions',
  'status_changes',
  'priority_eta',
  'reassignments',
  'comments',
  'other',
];
const ICON: Record<InboxGroup, IconName> = {
  assignments: 'users',
  mentions: 'mail',
  status_changes: 'swap',
  priority_eta: 'cal',
  reassignments: 'users',
  comments: 'info',
  other: 'bookmark',
};
/** The Team filter's stand-in for "no team": private cards and unassigned org cards. */
const NO_TEAM = 'none';
const PAGE = 25;
type Tab = InboxGroup | 'all';

/** Today / Last 7 days / Earlier, by the person's own calendar day (display only). */
function bucketOf(iso: string): 'today' | 'week' | 'earlier' {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(new Date(iso))) / 86_400_000);
  return days <= 0 ? 'today' : days < 7 ? 'week' : 'earlier';
}

function Row({
  item,
  onOpen,
  onRead,
}: {
  item: InboxItem;
  onOpen: () => void;
  onRead: () => void;
}) {
  const names = useEventNames();
  return (
    <li
      className={cx(s.inboxRow, item.unread && s.inboxUnread)}
      data-testid={item.unread ? 'inbox-item-unread' : 'inbox-item'}
    >
      <span className={cx(s.inboxIcon, s[`inboxIcon_${item.group}`])} aria-hidden="true">
        <Icon name={ICON[item.group]} size={20} />
      </span>
      <div className={s.inboxMain}>
        <div className={s.inboxTitle}>
          <Pill
            tone={
              item.reason === 'assigned' || item.reason === 'mentioned'
                ? 'accent'
                : item.reason === 'comment'
                  ? 'success'
                  : 'muted'
            }
          >
            {t(`inbox.reason.${item.reason}` as 'inbox.reason.team')}
          </Pill>
          <Link to={`/cards/${item.card.key}`} className={s.inboxKey} onClick={onOpen}>
            {item.card.key}
          </Link>
          <span className={s.inboxCard}>{item.card.title}</span>
        </div>
        <div className={s.diff}>
          <Pill tone="muted">{eventLabel(item.event.field)}</Pill>
          {item.event.field !== 'created' ? (
            <Change
              old={item.event.oldValue}
              now={item.event.newValue}
              names={names}
              field={item.event.field}
            />
          ) : null}
        </div>
      </div>
      <div className={s.inboxSide}>
        <span className={s.hint}>{`${item.event.actor.name} · ${when(item.event.createdAt)}`}</span>
        {item.unread ? (
          <span className={s.inboxNew} data-testid="inbox-new">
            <span className={s.inboxDot} aria-hidden="true" />
            {t('inbox.new')}
          </span>
        ) : null}
        <details className={s.cardMenu} data-popover>
          <summary
            className={s.cardMenuButton}
            aria-label={t('inbox.actions', { key: item.card.key })}
            title={t('inbox.actions', { key: item.card.key })}
          >
            <Icon name="more" size={18} />
          </summary>
          <div className={cx(s.cardMenuPanel, s.inboxMenu)}>
            <Link to={`/cards/${item.card.key}`} className={s.inboxMenuItem} onClick={onOpen}>
              {t('inbox.openCard')}
            </Link>
            {item.unread ? (
              <button
                type="button"
                className={s.inboxMenuItem}
                onClick={(e) => {
                  e.currentTarget.closest('details')?.removeAttribute('open');
                  onRead();
                }}
                data-testid="inbox-mark-read"
              >
                {t('inbox.markRead')}
              </button>
            ) : null}
          </div>
        </details>
      </div>
    </li>
  );
}

/** One tab's list: its own page over the same filters, newest first, split by day (CR-16). */
function Items({
  filter,
  tab,
  total,
  onRead,
}: {
  filter: InboxFilter;
  tab: Tab;
  total: number;
  onRead: (ids: string[]) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const page = useInbox(filter, tab === 'all' ? undefined : tab, limit);
  const items = page.data?.items ?? [];
  if (page.isPending) return <Skeleton lines={3} label={t('skeleton.label')} />;
  if (page.isError) return <Alert tone="danger">{t('error.body')}</Alert>;
  const buckets = (['today', 'week', 'earlier'] as const)
    .map((b) => ({ b, rows: items.filter((it) => bucketOf(it.event.createdAt) === b) }))
    .filter((x) => x.rows.length > 0);
  return (
    <div className={s.inboxList} data-testid={`inbox-items-${tab}`}>
      {buckets.map(({ b, rows }, i) => (
        <section key={b} aria-labelledby={`inbox-${tab}-${b}`}>
          <h2 id={`inbox-${tab}-${b}`} className={s.inboxBucket}>
            <span>
              {t(`inbox.bucket.${b}`)}
              <span className={s.inboxBucketCount}>
                {` · ${t(rows.length === 1 ? 'inbox.item1' : 'inbox.items', { n: rows.length })}`}
              </span>
            </span>
            {i === 0 ? (
              <span className={s.hint}>
                {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date())}
              </span>
            ) : null}
          </h2>
          <ol className={s.inboxRows}>
            {rows.map((it) => (
              <Row
                key={it.event.id}
                item={it}
                onOpen={() => it.unread && onRead([it.event.id])}
                onRead={() => onRead([it.event.id])}
              />
            ))}
          </ol>
        </section>
      ))}
      {items.length < total ? (
        <Button
          variant="ghost"
          onClick={() => setLimit(limit + PAGE)}
          data-testid={`inbox-more-${tab}`}
        >
          {`${t('inbox.showMore')} (${t('inbox.showing', { shown: items.length, total })})`}
        </Button>
      ) : null}
    </div>
  );
}

export function Inbox() {
  const [teamId, setTeamId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [clearDate, setClearDate] = useState('');
  const filter: InboxFilter = { teamId, projectId, assignedToMe };
  // One request for the unread count, the total and every group's true total; the open tab then
  // fetches its own page. `limit: 1` because the header never renders these items.
  const head = useInbox(filter, undefined, 1);
  const teams = useTeams();
  const projects = useProjects({ includeClosed: true });
  const seen = useMarkInboxSeen();
  const read = useMarkInboxRead();
  const clear = useClearInbox();
  const qc = useQueryClient();
  const groups = head.data?.groups ?? [];
  const totalOf = (g: InboxGroup) => groups.find((x) => x.group === g)?.total ?? 0;
  const all = head.data?.total ?? 0;
  const inSelectedTeam = (p: { team: { id: string } }) => !teamId || p.team.id === teamId;
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['inbox'] });
    await qc.invalidateQueries({ queryKey: ME_KEY });
  };

  return (
    <div className={s.page} data-testid="inbox">
      <div className={s.head}>
        <div className={s.titleBlock}>
          <h1 className={cx(pageTitleClass, s.inboxHeading)}>
            {t('inbox.title')}
            {head.data && head.data.unread > 0 ? (
              <span className={s.badge} data-testid="inbox-unread">
                {head.data.unread}
              </span>
            ) : null}
          </h1>
          <p className={s.subtitle}>{t('inbox.lead')}</p>
        </div>
        {head.data && head.data.unread > 0 ? (
          <Button
            variant="secondary"
            busy={seen.isPending}
            onClick={() => void seen.mutateAsync().then(refresh)}
            data-testid="inbox-seen"
          >
            <Icon name="check" size={18} />
            {t('inbox.markSeen')}
          </Button>
        ) : null}
      </div>

      <div className={s.filters} role="group" aria-label={t('inbox.filters')}>
        <select
          className={s.input}
          aria-label={t('inbox.team')}
          value={teamId}
          onChange={(e) => {
            setTeamId(e.target.value);
            setProjectId(''); // the project list cascades off the team, as the board does
          }}
          data-testid="inbox-filter-team"
        >
          <option value="">{t('inbox.allTeams')}</option>
          <option value={NO_TEAM}>{t('inbox.noTeam')}</option>
          {(teams.data?.items ?? []).map((tm) => (
            <option key={tm.id} value={tm.id}>
              {tm.name}
            </option>
          ))}
        </select>
        <select
          className={s.input}
          aria-label={t('inbox.project')}
          value={projectId}
          disabled={teamId === NO_TEAM} // a card with no team has no project
          onChange={(e) => setProjectId(e.target.value)}
          data-testid="inbox-filter-project"
        >
          <option value="">{t('inbox.allProjects')}</option>
          {(projects.data?.items ?? []).filter(inSelectedTeam).map((p) => (
            <option key={p.id} value={p.id}>
              {teamId ? p.name : `${p.team.name} / ${p.name}`}
            </option>
          ))}
        </select>
        <label className={s.check}>
          <input
            type="checkbox"
            checked={assignedToMe}
            onChange={(e) => setAssignedToMe(e.target.checked)}
            data-testid="inbox-filter-mine"
          />
          {t('inbox.assignedToMe')}
        </label>
        <label className={s.check}>
          <span className="visually-hidden">{t('inbox.clearLabel')}</span>
          <input
            className={cx(s.input, s.dateInput)}
            type="date"
            value={clearDate}
            onChange={(e) => setClearDate(e.target.value)}
            title={t('inbox.clearLabel')}
            data-testid="inbox-clear-date"
          />
        </label>
        <Button
          variant="ghost"
          disabled={!clearDate}
          busy={clear.isPending}
          title={t('inbox.clearHint')}
          onClick={() => clear.mutate(new Date(`${clearDate}T23:59:59.999`).toISOString())}
          data-testid="inbox-clear"
        >
          {t('inbox.clear')}
        </Button>
      </div>

      <div className={s.inboxTabs} role="tablist" aria-label={t('inbox.groups')}>
        {(['all', ...GROUPS] as Tab[]).map((g) => {
          const n = g === 'all' ? all : totalOf(g);
          return (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={tab === g}
              className={cx(
                s.inboxTab,
                tab === g && s.inboxTabOn,
                g !== 'all' && s[`inboxTab_${g}`],
              )}
              onClick={() => setTab(g)}
              data-testid={`inbox-tab-${g}`}
            >
              {g !== 'all' ? <Icon name={ICON[g]} size={16} /> : null}
              {g === 'all' ? t('inbox.all') : t(`inbox.group.${g}` as 'inbox.group.other')}
              <span className={s.inboxTabCount}>{n}</span>
            </button>
          );
        })}
      </div>

      {head.isPending ? (
        <Skeleton lines={5} label={t('skeleton.label')} />
      ) : head.isError ? (
        <Alert tone="danger">{t('error.body')}</Alert>
      ) : (tab === 'all' ? all : totalOf(tab)) === 0 ? (
        <EmptyState title={t('inbox.empty.title')} body={t('inbox.empty.body')} />
      ) : (
        <Items
          key={tab}
          filter={filter}
          tab={tab}
          total={tab === 'all' ? all : totalOf(tab)}
          onRead={(ids) => read.mutate(ids, { onSuccess: () => void refresh() })}
        />
      )}
    </div>
  );
}
