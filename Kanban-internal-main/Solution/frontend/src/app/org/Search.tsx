// Search (D-063, FR-054): one search bar (searches as you type), filters as selects plus the
// active ones as removable chips, and the hits as a sortable table - cards below 640px. Every
// filter lives in the URL, so a search can be shared or bookmarked. The server decides what the
// caller may see; sorting here only reorders the page of results it returned.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Pill } from '../../components';
import { Avatar } from '../../components/Avatar';
import { MQ, useMediaQuery } from '../../components/useMediaQuery';
import { t } from '../../i18n/t';
import { cx } from '../../styles/cx';
import { pageTitleClass } from '../Shell';
import { STATES, useSearch, type CardState } from '../cards/api';
import { PriorityPill, STATE_LABEL } from '../cards/Board';
import c from '../cards/cards.module.css';
import { usePrograms, useProjects, useTags, useTeams, useUsers } from './api';
import s from './search.module.css';

const KEYS = ['q', 'plane', 'teamId', 'programId', 'projectId', 'assigneeId', 'state', 'tag'];
type Sort = 'relevance' | 'key' | 'priority' | 'eta' | 'state';
const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortDate = (iso: string) => DATE.format(new Date(`${iso}T00:00:00Z`));

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const [draft, setDraft] = useState(get('q'));
  const [sort, setSort] = useState<Sort>('relevance');
  const wide = useMediaQuery(MQ.tabletUp);
  // Phones: the filters fold away behind a button so the results stay on the first screen.
  const [showFilters, setShowFilters] = useState(false);

  const query: Record<string, string | number | boolean> = {};
  for (const k of KEYS) if (get(k)) query[k] = get(k);
  if (get('priority')) query['priority'] = Number(get('priority'));
  if (get('open') === '1') query['includeClosed'] = false;
  const results = useSearch(query);
  const teams = useTeams();
  const programs = usePrograms();
  const projects = useProjects();
  const users = useUsers();
  const tags = useTags();
  const teamName = new Map((teams.data?.items ?? []).map((tm) => [tm.id, tm.name]));
  const programName = new Map((programs.data?.items ?? []).map((p) => [p.id, p.name]));
  const projectName = new Map((projects.data?.items ?? []).map((p) => [p.id, p.name]));
  const people = new Map((users.data?.items ?? []).map((u) => [u.id, u]));

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === 'programId') next.delete('projectId');
    setParams(next, { replace: k === 'q' });
  };

  // Search as you type: the URL follows the box a moment after typing stops.
  useEffect(() => {
    const q = draft.trim();
    if (q === get('q')) return;
    const id = window.setTimeout(() => set('q', q), 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `set`/`get` read the live URL
  }, [draft]);

  const filterSelect = (
    k: string,
    label: string,
    anyLabel: string,
    options: { value: string; label: string }[],
  ) => (
    <label className={s.filter}>
      <span className={s.filterLabel}>{label}</span>
      <select
        className={cx(c.input, s.select)}
        value={get(k)}
        onChange={(e) => set(k, e.target.value)}
        data-testid={`search-${k}`}
      >
        <option value="">{anyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  // The active filters, as chips that remove themselves.
  const chips: { k: string; label: string }[] = [];
  const add = (k: string, name: string, value: string | undefined) => {
    if (get(k)) chips.push({ k, label: `${name}: ${value ?? get(k)}` });
  };
  add(
    'plane',
    t('search.plane'),
    get('plane') && t(get('plane') === 'private' ? 'card.plane.private' : 'card.plane.org'),
  );
  add('teamId', t('card.team'), teamName.get(get('teamId')));
  add('programId', t('board.program'), programName.get(get('programId')));
  add('projectId', t('board.project'), projectName.get(get('projectId')));
  add('assigneeId', t('board.assignee'), people.get(get('assigneeId'))?.name);
  add('state', t('card.state'), get('state') && t(STATE_LABEL[get('state') as CardState]));
  add('tag', t('board.tag'), get('tag'));
  add('priority', t('board.priority'), get('priority') && `P${get('priority')}`);
  if (get('open') === '1') chips.push({ k: 'open', label: t('search.openOnly') });

  const hits = [...(results.data?.items ?? [])];
  const order = (st: string) => STATES.indexOf(st as CardState);
  if (sort === 'key') hits.sort((a, b) => Number(a.key.slice(2)) - Number(b.key.slice(2)));
  if (sort === 'priority') hits.sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5)); // none last
  if (sort === 'state') hits.sort((a, b) => order(a.state) - order(b.state));
  if (sort === 'eta') hits.sort((a, b) => (a.eta ?? '9999').localeCompare(b.eta ?? '9999'));

  const who = (id: string | null) => {
    const u = id ? people.get(id) : undefined;
    return u ? (
      <span className={s.person}>
        <Avatar user={u} size={22} />
        <span className={s.personName}>{u.name}</span>
      </span>
    ) : (
      <span className={s.muted}>{t('search.nobody')}</span>
    );
  };
  const stateCell = (st: string) => (
    <Pill tone="muted">{t(STATE_LABEL[st as CardState] ?? 'state.backlog')}</Pill>
  );
  const teamCell = (id: string | null, plane: string) =>
    plane === 'private' ? (
      <span className={s.muted}>{t('card.plane.private')}</span>
    ) : (
      (teamName.get(id ?? '') ?? <span className={s.muted}>{t('search.noTeam')}</span>)
    );

  return (
    <div className={c.page} data-testid="search-page">
      <h1 className={pageTitleClass}>{t('search.title')}</h1>

      <form
        className={s.bar}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          set('q', draft.trim());
        }}
      >
        <label className="visually-hidden" htmlFor="search-q">
          {t('search.label')}
        </label>
        <svg className={s.barIcon} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35" />
        </svg>
        <input
          id="search-q"
          className={s.barInput}
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('search.placeholder')}
          autoComplete="off"
          data-testid="search-input"
        />
        <button type="submit" className={s.barButton}>
          {t('search.go')}
        </button>
      </form>

      <section className={s.filters} aria-label={t('search.filters')}>
        {wide ? null : (
          <button
            type="button"
            className={s.filtersToggle}
            aria-expanded={showFilters}
            aria-controls="search-filter-grid"
            onClick={() => setShowFilters(!showFilters)}
            data-testid="search-filters-toggle"
          >
            {t('search.filtersCount', { n: String(chips.length) })}
            <span aria-hidden="true">{showFilters ? '▴' : '▾'}</span>
          </button>
        )}
        <div
          id="search-filter-grid"
          className={s.filterGrid}
          role="group"
          aria-label={t('search.filters')}
          hidden={!wide && !showFilters}
        >
          {filterSelect('plane', t('search.plane'), t('search.anyPlane'), [
            { value: 'private', label: t('card.plane.private') },
            { value: 'org', label: t('card.plane.org') },
          ])}
          {filterSelect(
            'teamId',
            t('card.team'),
            t('search.anyTeam'),
            (teams.data?.items ?? []).map((tm) => ({ value: tm.id, label: tm.name })),
          )}
          {filterSelect(
            'programId',
            t('board.program'),
            t('board.anyProgram'),
            (programs.data?.items ?? []).map((pr) => ({ value: pr.id, label: pr.name })),
          )}
          {filterSelect(
            'projectId',
            t('board.project'),
            t('board.anyProject'),
            (projects.data?.items ?? [])
              .filter((pr) => !get('programId') || pr.program?.id === get('programId'))
              .map((pr) => ({ value: pr.id, label: `${pr.team.name} / ${pr.name}` })),
          )}
          {filterSelect(
            'assigneeId',
            t('board.assignee'),
            t('board.anyAssignee'),
            (users.data?.items ?? []).map((u) => ({ value: u.id, label: u.name })),
          )}
          {filterSelect(
            'state',
            t('card.state'),
            t('search.anyState'),
            STATES.map((st) => ({ value: st, label: t(STATE_LABEL[st]) })),
          )}
          {filterSelect(
            'tag',
            t('board.tag'),
            t('board.anyTag'),
            (tags.data?.items ?? []).map((tg) => ({ value: tg.name, label: tg.name })),
          )}
          {filterSelect(
            'priority',
            t('board.priority'),
            t('board.anyPriority'),
            [1, 2, 3, 4].map((n) => ({
              value: String(n),
              label: t('card.priorityShort', { n: String(n) }),
            })),
          )}
          <label className={cx(c.check, s.openOnly)}>
            <input
              type="checkbox"
              checked={get('open') === '1'}
              onChange={(e) => set('open', e.target.checked ? '1' : '')}
              data-testid="search-open"
            />
            {t('search.openOnly')}
          </label>
        </div>
        {chips.length > 0 ? (
          <div className={s.chips} data-testid="search-chips">
            {chips.map((ch) => (
              <button
                key={ch.k}
                type="button"
                className={s.chip}
                onClick={() => {
                  if (ch.k === 'q') setDraft('');
                  set(ch.k, '');
                }}
                aria-label={t('search.removeFilter', { filter: ch.label })}
                data-testid={`chip-${ch.k}`}
              >
                {ch.label}
                <span aria-hidden="true" className={s.chipX}>
                  {'×'}
                </span>
              </button>
            ))}
            <button
              type="button"
              className={s.clear}
              onClick={() => setParams(get('q') ? { q: get('q') } : {})}
              data-testid="search-clear"
            >
              {t('search.clearAll')}
            </button>
          </div>
        ) : null}
      </section>

      {/* D-121: the results table and its columns stay on screen while searching; an empty
          search or no match is a line inside it, not a different page. */}
      {(() => {
        const idle = Object.keys(query).length === 0;
        const loading = !idle && results.isPending;
        const empty = idle
          ? t('search.hint')
          : loading
            ? t('skeleton.label')
            : t('search.empty.body', { q: get('q') || t('search.yourFilters') });
        return (
          <section className={s.results} aria-labelledby="search-count">
            <div className={s.resultsHead}>
              <h2 id="search-count" className={s.count}>
                {idle || loading
                  ? t('search.results')
                  : t('search.count', { n: String(results.data?.total ?? 0) })}
              </h2>
              <label className={s.sort}>
                <span>{t('search.sortBy')}</span>
                <select
                  className={cx(c.input, s.select)}
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  data-testid="search-sort"
                >
                  <option value="relevance">{t('search.sort.relevance')}</option>
                  <option value="key">{t('search.sort.key')}</option>
                  <option value="priority">{t('search.sort.priority')}</option>
                  <option value="state">{t('search.sort.state')}</option>
                  <option value="eta">{t('search.sort.eta')}</option>
                </select>
              </label>
            </div>
            {wide ? (
              <div className={s.scroll} tabIndex={0} role="region" aria-labelledby="search-count">
                <table className={s.table} data-testid="search-results">
                  <thead>
                    <tr>
                      <th scope="col">{t('search.col.key')}</th>
                      <th scope="col">{t('search.col.title')}</th>
                      <th scope="col">{t('card.state')}</th>
                      <th scope="col">{t('board.priority')}</th>
                      <th scope="col">{t('card.team')}</th>
                      <th scope="col">{t('board.project')}</th>
                      <th scope="col">{t('board.assignee')}</th>
                      <th scope="col">{t('search.col.eta')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hits.length === 0 ? (
                      <tr>
                        <td colSpan={8} className={s.emptyRow} data-testid="search-empty">
                          {empty}
                        </td>
                      </tr>
                    ) : null}
                    {hits.map((hit) => (
                      <tr key={hit.id} data-testid={`hit-${hit.key}`}>
                        <td className={s.key}>{hit.key}</td>
                        <td className={s.titleCell}>
                          <Link to={`/cards/${hit.key}`} className={s.title}>
                            {hit.title}
                          </Link>
                          {hit.closedAt ? (
                            <span className={s.closed}>{t('search.closed')}</span>
                          ) : null}
                        </td>
                        <td>{stateCell(hit.state)}</td>
                        <td>
                          <PriorityPill priority={hit.priority} />
                        </td>
                        <td className={s.nowrap}>{teamCell(hit.teamId, hit.plane)}</td>
                        <td className={s.clip}>
                          {hit.projectId ? (projectName.get(hit.projectId) ?? '') : ''}
                        </td>
                        <td>{who(hit.assigneeId)}</td>
                        <td className={s.nowrap}>
                          {hit.eta ? shortDate(hit.eta) : <span className={s.muted}>{'–'}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className={s.cards} data-testid="search-results">
                {hits.length === 0 ? (
                  <li className={cx(s.card, s.emptyRow)} data-testid="search-empty">
                    {empty}
                  </li>
                ) : null}
                {hits.map((hit) => (
                  <li key={hit.id} className={s.card} data-testid={`hit-${hit.key}`}>
                    <Link to={`/cards/${hit.key}`} className={s.title}>
                      <span className={s.key}>{hit.key}</span> {hit.title}
                    </Link>
                    <div className={s.cardMeta}>
                      {stateCell(hit.state)}
                      <PriorityPill priority={hit.priority} />
                      {hit.eta ? <span className={s.muted}>{shortDate(hit.eta)}</span> : null}
                    </div>
                    <div className={s.cardFoot}>
                      <span className={s.clip}>{teamCell(hit.teamId, hit.plane)}</span>
                      {who(hit.assigneeId)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })()}
    </div>
  );
}
