// Backlog tab (D-152, the user's mockup): the board's Backlog cards - same scope and filters,
// from the same request - as a table with sorting, pages and row selection. Selected rows can
// be moved, given a priority or taken ("Assign to me") together; each card goes through the
// normal API one by one, so every rule and history entry still applies, and the ones the server
// refuses are counted and named. A row is a card on a phone. Overdue comes from the server.
import { useState } from 'react';
import { Link } from 'react-router';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components';
import { Icon } from '../../components/Icon';
import { MQ, useMediaQuery } from '../../components/useMediaQuery';
import { problemMessage, type Problem } from '../../api/client';
import { t } from '../../i18n/t';
import { cx } from '../../styles/cx';
import { formatDate } from '../../styles/format';
import { PriorityPill, STATE_LABEL } from './Board';
import { STATES, useMoveCard, usePatchCard, type Card, type CardState } from './api';
import { projectStyle, tagStyle } from './projectColor';
import { Pager } from './Pager';
import s from './cards.module.css';

type Sort = 'priority' | 'priorityAsc' | 'due' | 'newest' | 'oldest' | 'title';
const SORTS: Sort[] = ['priority', 'priorityAsc', 'due', 'newest', 'oldest', 'title'];
const TAGS_SHOWN = 2;

/** No priority / no ETA sort last whichever way the list runs. */
const byNullLast = (a: number | null, b: number | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b;

function sorted(cards: Card[], sort: Sort): Card[] {
  const list = [...cards];
  const due = (c: Card) => (c.eta ? Date.parse(c.eta) : null);
  const cmp: Record<Sort, (a: Card, b: Card) => number> = {
    priority: (a, b) => byNullLast(a.priority, b.priority) || byNullLast(due(a), due(b)),
    priorityAsc: (a, b) =>
      byNullLast(
        a.priority === null ? null : -a.priority,
        b.priority === null ? null : -b.priority,
      ),
    due: (a, b) => byNullLast(due(a), due(b)) || byNullLast(a.priority, b.priority),
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
    title: (a, b) => a.title.localeCompare(b.title),
  };
  return list.sort(cmp[sort]);
}

export function BacklogTable({
  cards,
  cardHref,
  projects,
  users,
  canCreate,
  onAdd,
  meId,
}: {
  cards: Card[];
  cardHref: (key: string) => string;
  projects: Map<string, { name: string; program: string | null }>;
  users: Map<string, { id: string; name: string; photoUpdatedAt?: string | null }>;
  canCreate: boolean;
  onAdd: () => void;
  meId: string;
}) {
  const wide = useMediaQuery(MQ.tabletUp);
  const [sort, setSort] = useState<Sort>('priority');
  const [size, setSize] = useState(10);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkState, setBulkState] = useState<CardState | ''>('');
  const [bulkPriority, setBulkPriority] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: string[] } | null>(null);
  const move = useMoveCard();
  const patch = usePatchCard();

  const list = sorted(cards, sort);
  const pages = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(page, pages);
  const rows = list.slice((current - 1) * size, current * size);
  const chosen = list.filter((c) => picked.has(c.key));
  const allOnPage = rows.length > 0 && rows.every((c) => picked.has(c.key));
  const toggle = (key: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const togglePage = () =>
    setPicked((p) => {
      const n = new Set(p);
      for (const c of rows) {
        if (allOnPage) n.delete(c.key);
        else n.add(c.key);
      }
      return n;
    });

  /** One card at a time through the normal API; refusals are collected, not fatal. */
  async function each(fn: (c: Card) => Promise<unknown>) {
    setBusy(true);
    setResult(null);
    let ok = 0;
    const failed: string[] = [];
    for (const c of chosen) {
      try {
        await fn(c);
        ok++;
      } catch (p) {
        failed.push(`${c.key}: ${problemMessage(p as Problem)}`);
      }
    }
    setBusy(false);
    setResult({ ok, failed });
    setPicked(new Set());
  }
  const moveOne = (c: Card, state: CardState) =>
    move.mutateAsync({ key: c.key, state, version: c.version });

  const due = (c: Card) =>
    c.eta ? (
      <span
        className={cx(c.overdue && s.overdue)}
        title={c.overdue ? t('backlog.overdueTip') : undefined}
      >
        {formatDate(c.eta)}
        {c.overdue ? <span className="visually-hidden">{` ${t('backlog.overdue')}`}</span> : null}
      </span>
    ) : (
      <span className={s.muted}>{'–'}</span>
    );
  const tags = (c: Card) => (
    <span className={s.tagCell}>
      {c.tags.slice(0, TAGS_SHOWN).map((tg) => (
        <span key={tg} className={s.tagPill} style={tagStyle(tg)}>
          {tg}
        </span>
      ))}
      {c.tags.length > TAGS_SHOWN ? (
        <span className={s.moreTags} title={c.tags.slice(TAGS_SHOWN).join(', ')}>
          {`+${c.tags.length - TAGS_SHOWN}`}
        </span>
      ) : null}
    </span>
  );
  const project = (c: Card) => {
    const p = c.projectId ? projects.get(c.projectId) : undefined;
    return p ? (
      <span className={s.projectPill} style={projectStyle(c.projectId)} title={p.name}>
        {p.name}
      </span>
    ) : (
      <span className={s.muted}>{'–'}</span>
    );
  };
  const program = (c: Card) => {
    const name = c.projectId ? projects.get(c.projectId)?.program : null;
    return name ? (
      <span className={s.programPill}>{name}</span>
    ) : (
      <span className={s.muted}>{'–'}</span>
    );
  };
  const person = (c: Card) => {
    const u = c.assigneeId ? users.get(c.assigneeId) : undefined;
    return u ? (
      <span className={s.personCell}>
        <Avatar user={u} size={26} />
        <span className={s.personCellName}>{u.name}</span>
      </span>
    ) : (
      <span className={s.muted}>{t('card.unassigned')}</span>
    );
  };
  const menu = (c: Card) => (
    <details className={s.cardMenu} data-popover data-testid={`menu-${c.key}`}>
      <summary
        className={s.cardMenuButton}
        aria-label={t('card.actions', { key: c.key })}
        title={t('card.actions', { key: c.key })}
      >
        <Icon name="more" size={18} />
      </summary>
      <div className={s.cardMenuPanel}>
        <label className={s.moveLabel}>
          <span className={s.menuLabel}>{t('card.moveTo', { key: c.key })}</span>
          <select
            className={s.moveSelect}
            value={c.state}
            onChange={(e) => {
              e.currentTarget.closest('details')?.removeAttribute('open');
              void moveOne(c, e.target.value as CardState).catch((p: unknown) =>
                setResult({ ok: 0, failed: [`${c.key}: ${problemMessage(p as Problem)}`] }),
              );
            }}
            disabled={!c.canMove}
            title={c.canMove ? undefined : t('card.moveNotYours')}
            data-testid={`move-${c.key}`}
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
  );
  const check = (c: Card) => (
    <input
      type="checkbox"
      className={s.rowCheck}
      checked={picked.has(c.key)}
      onChange={() => toggle(c.key)}
      aria-label={t('backlog.select', { key: c.key })}
      data-testid={`pick-${c.key}`}
    />
  );
  const title = (c: Card) => (
    <span className={s.titleCell}>
      <span
        className={cx(s.prioDot, c.priority !== null && s[`prio${c.priority}`])}
        aria-hidden="true"
      />
      <Link to={cardHref(c.key)} className={s.rowTitle} title={`${c.key} · ${c.title}`}>
        {c.title}
      </Link>
    </span>
  );

  return (
    <section className={s.backlog} data-testid="column-backlog" aria-labelledby="backlog-title">
      <div className={s.backlogHead}>
        <div className={s.titleBlock}>
          <h2 id="backlog-title" className={s.backlogTitle}>
            {t('state.backlog')}
            <span className={s.backlogCount} data-testid="backlog-count">
              {t('backlog.count', { n: cards.length })}
            </span>
          </h2>
          <p className={s.subtitle}>{t('backlog.lead')}</p>
        </div>
        <label className={s.sortLabel}>
          <Icon name="swap" size={18} />
          <span className="visually-hidden">{t('backlog.sort')}</span>
          <select
            className={s.input}
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as Sort);
              setPage(1);
            }}
            data-testid="backlog-sort"
          >
            {SORTS.map((o) => (
              <option key={o} value={o}>
                {t(`backlog.sort.${o}`)}
              </option>
            ))}
          </select>
        </label>
        {canCreate ? (
          <Button variant="primary" onClick={onAdd} data-testid="column-add-backlog">
            <Icon name="plus" size={18} />
            {t('backlog.add')}
          </Button>
        ) : null}
      </div>

      {chosen.length > 0 ? (
        <div className={s.bulkBar} role="group" aria-label={t('backlog.bulk')} data-testid="bulk">
          <strong>{t('backlog.selected', { n: chosen.length })}</strong>
          <select
            className={s.input}
            value={bulkState}
            onChange={(e) => setBulkState(e.target.value as CardState | '')}
            aria-label={t('backlog.bulkMove')}
            data-testid="bulk-state"
          >
            <option value="">{t('backlog.bulkMove')}</option>
            {STATES.filter((st) => st !== 'backlog').map((st) => (
              <option key={st} value={st}>
                {t(STATE_LABEL[st])}
              </option>
            ))}
          </select>
          <Button
            disabled={!bulkState || busy}
            onClick={() => bulkState && void each((c) => moveOne(c, bulkState))}
            data-testid="bulk-move"
          >
            {t('backlog.apply')}
          </Button>
          <select
            className={s.input}
            value={bulkPriority}
            onChange={(e) => setBulkPriority(e.target.value)}
            aria-label={t('backlog.bulkPriority')}
            data-testid="bulk-priority"
          >
            <option value="">{t('backlog.bulkPriority')}</option>
            {[1, 2, 3, 4].map((p) => (
              <option key={p} value={p}>
                {t('card.priorityShort', { n: String(p) })}
              </option>
            ))}
            <option value="none">{t('backlog.noPriority')}</option>
          </select>
          <Button
            disabled={!bulkPriority || busy}
            onClick={() =>
              void each((c) =>
                patch.mutateAsync({
                  key: c.key,
                  body: {
                    version: c.version,
                    priority: bulkPriority === 'none' ? null : Number(bulkPriority),
                  },
                }),
              )
            }
            data-testid="bulk-priority-apply"
          >
            {t('backlog.apply')}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void each((c) =>
                patch.mutateAsync({ key: c.key, body: { version: c.version, assigneeId: meId } }),
              )
            }
            data-testid="bulk-mine"
          >
            {t('backlog.assignMe')}
          </Button>
          <Button variant="secondary" onClick={() => setPicked(new Set())}>
            {t('backlog.clear')}
          </Button>
        </div>
      ) : null}
      {result ? (
        <p
          className={cx(s.bulkResult, result.failed.length > 0 && s.bulkFailed)}
          role="status"
          data-testid="bulk-result"
        >
          {t('backlog.result', { ok: result.ok, failed: result.failed.length })}
          {result.failed.length > 0 ? ` ${result.failed.join('; ')}` : null}
        </p>
      ) : null}

      {wide ? (
        <div className={s.tableScroll} tabIndex={0} role="region" aria-label={t('state.backlog')}>
          <table className={s.backlogTable}>
            <thead>
              <tr>
                <th scope="col" className={s.checkCol}>
                  <input
                    type="checkbox"
                    className={s.rowCheck}
                    checked={allOnPage}
                    onChange={togglePage}
                    aria-label={t('backlog.selectPage')}
                    data-testid="pick-page"
                  />
                </th>
                <th scope="col">{t('backlog.col.title')}</th>
                <th scope="col">{t('card.priority')}</th>
                <th scope="col">{t('backlog.col.tags')}</th>
                <th scope="col">{t('card.project')}</th>
                <th scope="col">{t('backlog.col.program')}</th>
                <th scope="col">{t('backlog.col.created')}</th>
                <th scope="col">{t('backlog.col.due')}</th>
                <th scope="col">{t('card.assignee')}</th>
                <th scope="col">{t('backlog.col.status')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('backlog.col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className={s.emptyCol}>
                    {t('board.emptyColumn')}
                  </td>
                </tr>
              ) : (
                rows.map((c) => (
                  <tr
                    key={c.id}
                    data-testid={`card-${c.key}`}
                    className={cx(picked.has(c.key) && s.rowPicked)}
                  >
                    <td className={s.checkCol}>{check(c)}</td>
                    <td>{title(c)}</td>
                    <td>
                      <PriorityPill priority={c.priority} />
                    </td>
                    <td>{tags(c)}</td>
                    <td>{project(c)}</td>
                    <td>{program(c)}</td>
                    <td className={s.nowrap}>{formatDate(c.createdAt.slice(0, 10))}</td>
                    <td className={s.nowrap}>{due(c)}</td>
                    <td>{person(c)}</td>
                    <td>
                      <span className={s.statusPill}>{t(STATE_LABEL[c.state])}</span>
                    </td>
                    <td>{menu(c)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className={s.cards}>
          {rows.length === 0 ? <li className={s.emptyCol}>{t('board.emptyColumn')}</li> : null}
          {rows.map((c) => (
            <li
              key={c.id}
              className={cx(s.card, s.backlogCard)}
              data-testid={`card-${c.key}`}
              style={projectStyle(c.projectId)}
            >
              <div className={s.cardTop}>
                {check(c)}
                {title(c)}
                <PriorityPill priority={c.priority} />
              </div>
              {c.tags.length > 0 ? tags(c) : null}
              {c.projectId && projects.has(c.projectId) ? (
                <div className={s.meta}>
                  {project(c)}
                  {program(c)}
                </div>
              ) : null}
              <div className={s.cardFoot}>
                <span className={s.eta}>{due(c)}</span>
                <span className={s.footEnd}>
                  {person(c)}
                  {menu(c)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pager
        page={current}
        size={size}
        total={list.length}
        showing={(from, to, n) => t('backlog.showing', { from, to, n })}
        onPage={setPage}
        onSize={(n) => {
          setSize(n);
          setPage(1);
        }}
        idPrefix="backlog"
      />
    </section>
  );
}
