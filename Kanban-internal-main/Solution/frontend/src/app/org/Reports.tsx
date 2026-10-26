// Reports (FR-060..062 / D-072): progress per project / program / person, overdue list, and
// the CR-13 effort CSV; graphs of the same rows (D-148). D-153, the user's mockup: a month (or all
// time) narrows the cards to those created or closed in it and the hours to those logged in it -
// the server applies it; an Export menu (effort CSV, the summary and the overdue list as shown);
// tiles, the two charts and a searchable, sortable, paged summary table, all from one grouping.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Pill, Skeleton } from '../../components';
import { Icon } from '../../components/Icon';
import { t } from '../../i18n/t';
import { pageTitleClass } from '../Shell';
import { STATES, useOverdueReport, useProgressReport, type ProgressRow } from '../cards/api';
import { PriorityPill, STATE_LABEL } from '../cards/Board';
import { Pager } from '../cards/Pager';
import c from '../cards/cards.module.css';
import s from './org.module.css';
import { usePrograms, useTeams } from './api';
import { EffortChart, OverdueChart, ReportSummary, StateChart, hours } from './ReportCharts';
import g from './reportCharts.module.css';
import { useContextData } from '../auth/useMe';

const MONTHS_BACK = 24;

/** "2026-10" → the first and last day of that month. */
function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** This month and the ones before it, newest first, as "YYYY-MM". */
function monthsUpTo(month: string): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return Array.from({ length: MONTHS_BACK }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function monthName(month: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

/** One CSV field, quoted, with a leading = + - @ neutralised so a spreadsheet never runs it
 *  (the same guard the server's effort CSV uses). */
function csvField(value: string | number | null): string {
  let v = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

function downloadCsv(name: string, lines: (string | number | null)[][]) {
  const body = lines.map((l) => l.map(csvField).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${body}\r\n`], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

type SortKey =
  'name' | 'target' | (typeof STATES)[number] | 'open' | 'noEta' | 'overdue' | 'effort' | 'logged';

export function Reports() {
  const [groupBy, setGroupBy] = useState<'project' | 'program' | 'person'>('project');
  const [teamId, setTeamId] = useState('');
  const [programId, setProgramId] = useState('');
  const [overdueBy, setOverdueBy] = useState<'team' | 'project' | 'assignee'>('team');
  const [csvOpen, setCsvOpen] = useState(false);
  // D-153: null = the server's current month (its "today", in the org time zone); 'all' = all time.
  const [month, setMonth] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const exportRef = useRef<HTMLDetailsElement>(null);
  const overdue = useOverdueReport(overdueBy);
  const serverMonth = overdue.data?.today.slice(0, 7);
  const chosen = month ?? serverMonth;
  const period = chosen && chosen !== 'all' ? monthRange(chosen) : null;
  const progress = useProgressReport({
    groupBy,
    teamId,
    programId,
    ...(period ?? {}),
    enabled: chosen !== undefined,
  });
  const teams = useTeams();
  const me = useContextData();
  // D-097 d: the server reports only on my teams (admins: all), so only those are offered.
  const teamChoices = (teams.data?.items ?? []).filter(
    (tm) => me.user.role === 'admin' || tm.isMember,
  );
  const programs = usePrograms();
  const open = STATES.filter((st) => st !== 'delivered' && st !== 'cancelled');
  const rows = progress.data?.rows ?? [];
  const groupLabel = t(
    groupBy === 'person'
      ? 'reports.groupPeople'
      : groupBy === 'program'
        ? 'reports.groupPrograms'
        : 'reports.groupProjects',
  );
  const groupHeader = t(
    groupBy === 'person'
      ? 'reports.person'
      : groupBy === 'program'
        ? 'programs.one'
        : 'projects.one',
  );
  const cancelled = rows.reduce((n, r) => n + r.cancelled, 0);

  // The summary table: the same rows, searched, sorted and paged here (display only).
  const value = (r: ProgressRow, key: SortKey): string | number => {
    switch (key) {
      case 'name':
        return r.name.toLowerCase();
      case 'target':
        return r.targetDate ?? '9999';
      case 'open':
        return r.open;
      case 'noEta':
        return r.noEta;
      case 'overdue':
        return r.overdue;
      case 'effort':
        return r.effortHours;
      case 'logged':
        return r.loggedHours;
      case 'delivered':
        return r.delivered;
      case 'cancelled':
        return r.cancelled;
      default:
        return r.byState[key] ?? 0;
    }
  };
  const found = rows
    .filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      const x = value(a, sort.key);
      const y = value(b, sort.key);
      const d =
        typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -d : d;
    });
  const pages = Math.max(1, Math.ceil(found.length / size));
  const current = Math.min(page, pages);
  const shown = found.slice((current - 1) * size, current * size);
  const columns: { key: SortKey; label: string; num?: boolean }[] = [
    { key: 'name', label: groupHeader },
    { key: 'target', label: t('reports.target') },
    ...open.map((st) => ({ key: st, label: t(STATE_LABEL[st]), num: true })),
    { key: 'delivered', label: t('state.delivered'), num: true },
    { key: 'open', label: t('reports.open'), num: true },
    { key: 'noEta', label: t('reports.chart.missingEta'), num: true },
    { key: 'overdue', label: t('reports.overdue'), num: true },
    { key: 'effort', label: t('reports.effort'), num: true },
    { key: 'logged', label: t('reports.logged'), num: true },
    { key: 'cancelled', label: t('state.cancelled'), num: true },
  ];
  const cell = (r: ProgressRow, key: SortKey): string | number => {
    if (key === 'name') return r.name;
    if (key === 'target') return r.targetDate ?? '–';
    if (key === 'effort') return hours(r.effortHours);
    if (key === 'logged') return hours(r.loggedHours);
    return value(r, key);
  };

  function exportSummary() {
    exportRef.current?.removeAttribute('open');
    downloadCsv(`kanban-summary-${groupBy}-${chosen ?? 'all'}.csv`, [
      columns.map((col) => col.label),
      ...found.map((r) => columns.map((col) => cell(r, col.key))),
    ]);
  }
  function exportOverdue() {
    exportRef.current?.removeAttribute('open');
    downloadCsv(`kanban-overdue-${overdueBy}-${overdue.data?.today ?? ''}.csv`, [
      [
        t('reports.groupBy'),
        t('reports.csv.key'),
        t('backlog.col.title'),
        t('backlog.col.status'),
        t('card.priority'),
        t('backlog.col.due'),
      ],
      ...(overdue.data?.groups ?? []).flatMap((og) =>
        og.cards.map((card) => [
          og.name,
          card.key,
          card.title,
          t(STATE_LABEL[card.state]),
          card.priority === null ? '' : `P${card.priority}`,
          card.eta,
        ]),
      ),
    ]);
  }

  return (
    <div className={`${c.page} ${g.reportPage}`} data-testid="reports">
      <div className={g.pageHead}>
        <div>
          <h1 className={pageTitleClass}>{t('reports.title')}</h1>
          <p className={c.subtitle}>{t('reports.subtitle')}</p>
        </div>
        <span className={g.headGap} />
        <label className={g.monthPick}>
          <Icon name="cal" size={18} />
          <span className="visually-hidden">{t('reports.month')}</span>
          <select
            className={c.input}
            value={chosen ?? ''}
            onChange={(e) => {
              setMonth(e.target.value);
              setPage(1);
            }}
            data-testid="report-month"
          >
            {serverMonth
              ? monthsUpTo(serverMonth).map((m) => (
                  <option key={m} value={m}>
                    {monthName(m)}
                  </option>
                ))
              : null}
            <option value="all">{t('reports.allTime')}</option>
          </select>
        </label>
        <details ref={exportRef} className={g.exportMenu} data-popover data-testid="export-menu">
          <summary className={g.exportButton} data-testid="export-open">
            <Icon name="download" size={18} />
            {t('reports.export')}
            <Icon name="down" size={16} />
          </summary>
          <div className={g.exportPanel}>
            <button
              type="button"
              onClick={() => {
                exportRef.current?.removeAttribute('open');
                setCsvOpen(true);
              }}
              data-testid="export-effort"
            >
              {t('reports.effortCsv')}
            </button>
            <button type="button" onClick={exportSummary} data-testid="export-summary">
              {t('reports.exportSummary')}
            </button>
            <button type="button" onClick={exportOverdue} data-testid="export-overdue">
              {t('reports.exportOverdue')}
            </button>
          </div>
        </details>
      </div>
      <p className={c.hint}>
        {t(period ? 'reports.leadPeriod' : 'reports.lead', {
          today: progress.data?.today ?? '',
          month: chosen && chosen !== 'all' ? monthName(chosen) : '',
        })}
      </p>

      {csvOpen ? (
        <EffortCsvDialog
          today={progress.data?.today ?? isoDay(new Date())}
          teamId={teamId}
          programId={programId}
          onClose={() => setCsvOpen(false)}
        />
      ) : null}
      <section className={s.section} data-testid="report-progress" aria-labelledby="progress-title">
        <h2 id="progress-title" className="visually-hidden">
          {t('reports.progress')}
        </h2>
        <div className={g.filterBar} role="group" aria-label={t('reports.filters')}>
          <select
            className={c.input}
            aria-label={t('reports.groupBy')}
            value={groupBy}
            onChange={(e) => {
              setGroupBy(e.target.value as typeof groupBy);
              setPage(1);
            }}
            data-testid="progress-groupby"
          >
            <option value="project">{t('reports.byProject')}</option>
            <option value="program">{t('reports.byProgram')}</option>
            <option value="person">{t('reports.byPerson')}</option>
          </select>
          <select
            className={c.input}
            aria-label={t('card.team')}
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            data-testid="progress-team"
          >
            <option value="">{t('search.anyTeam')}</option>
            {teamChoices.map((tm) => (
              <option key={tm.id} value={tm.id}>
                {tm.name}
              </option>
            ))}
          </select>
          <select
            className={c.input}
            aria-label={t('board.program')}
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            data-testid="progress-program"
          >
            <option value="">{t('board.anyProgram')}</option>
            {(programs.data?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button onClick={() => setCsvOpen(true)} data-testid="effort-csv">
            <Icon name="download" size={18} />
            {t('reports.effortCsv')}
          </Button>
          <span
            className={g.cancelledChip}
            data-testid="cancelled-chip"
            title={t('reports.cancelledTip')}
          >
            <span className={g.chipDot} aria-hidden="true" />
            {t('state.cancelled')}
            <span className={g.chipCount}>{cancelled}</span>
          </span>
        </div>
        {progress.isPending ? (
          <Skeleton lines={4} label={t('skeleton.label')} />
        ) : progress.isError ? (
          <Alert tone="danger">{t('error.body')}</Alert>
        ) : (
          <>
            <ReportSummary rows={rows} />
            <div className={g.charts}>
              <StateChart rows={rows} groupLabel={groupLabel} />
              <EffortChart rows={rows} groupLabel={groupLabel} />
            </div>
            <section
              className={g.panel}
              data-testid="report-summary-table"
              aria-labelledby="summary-title"
            >
              <div className={g.panelHead}>
                <div>
                  <h2 id="summary-title" className={g.panelTitle}>
                    {t('reports.summaryTitle', { group: groupHeader })}
                  </h2>
                  <p className={g.sub}>{t('reports.summarySub', { group: groupLabel })}</p>
                </div>
                <span className={g.headGap} />
                <label className={g.searchBox}>
                  <Icon name="search" size={18} />
                  <input
                    type="search"
                    className={g.searchInput}
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder={t('reports.searchGroups', { group: groupLabel })}
                    aria-label={t('reports.searchGroups', { group: groupLabel })}
                    data-testid="summary-search"
                  />
                </label>
              </div>
              <div
                className={s.tableWrap}
                tabIndex={0}
                role="region"
                aria-labelledby="summary-title"
              >
                <table className={s.table} data-testid="progress-table">
                  <thead>
                    <tr>
                      {columns.map((col) => (
                        <th
                          key={col.key}
                          className={col.num ? 'num' : undefined}
                          aria-sort={
                            sort.key === col.key
                              ? sort.desc
                                ? 'descending'
                                : 'ascending'
                              : undefined
                          }
                        >
                          <button
                            type="button"
                            className={g.sortButton}
                            onClick={() =>
                              setSort((p) => ({
                                key: col.key,
                                desc: p.key === col.key ? !p.desc : false,
                              }))
                            }
                            data-testid={`sort-${col.key}`}
                          >
                            {col.label}
                            <Icon name="swap" size={14} />
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id ?? 'none'} data-testid="progress-row">
                        {columns.map((col) => (
                          <td key={col.key} className={col.num ? 'num' : undefined}>
                            {cell(r, col.key)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {found.length === 0 ? <p className={c.hint}>{t('reports.empty')}</p> : null}
              </div>
              <Pager
                page={current}
                size={size}
                total={found.length}
                showing={(from, to, n) => t('reports.showing', { from, to, n, group: groupLabel })}
                onPage={setPage}
                onSize={(n) => {
                  setSize(n);
                  setPage(1);
                }}
                idPrefix="summary"
                pagePrefix="summary-"
              />
            </section>
          </>
        )}
      </section>

      <section className={`${s.section} ${g.panel}`} data-testid="report-overdue">
        <h2 className={g.panelTitle}>{t('reports.overdueTitle')}</h2>
        <p className={g.sub}>{t('reports.overdueSub')}</p>
        <select
          className={c.input}
          aria-label={t('reports.groupBy')}
          value={overdueBy}
          onChange={(e) => setOverdueBy(e.target.value as typeof overdueBy)}
          data-testid="overdue-groupby"
        >
          <option value="team">{t('reports.byTeam')}</option>
          <option value="project">{t('reports.byProject')}</option>
          <option value="assignee">{t('reports.byAssignee')}</option>
        </select>
        {overdue.isPending ? (
          <Skeleton lines={3} label={t('skeleton.label')} />
        ) : (overdue.data?.groups ?? []).length === 0 ? (
          <p className={c.hint}>{t('reports.noOverdue')}</p>
        ) : (
          <>
            <OverdueChart
              groups={(overdue.data?.groups ?? []).map((og) => ({
                id: og.id,
                name: og.name,
                n: og.cards.length,
              }))}
            />
            {(overdue.data?.groups ?? []).map((og) => (
              <div key={og.id ?? 'none'} data-testid="overdue-group">
                <h3 className={c.hint}>{`${og.name} · ${og.cards.length}`}</h3>
                <ul className={s.cardList}>
                  {og.cards.map((card) => (
                    <li key={card.id} className={s.cardItem}>
                      <Link to={`/cards/${card.key}`} className={s.cardTitle}>
                        <span className={c.key}>{card.key}</span> {card.title}
                      </Link>
                      <span className={c.meta}>
                        <Pill tone="danger">{t('card.etaShort', { date: card.eta ?? '' })}</Pill>
                        <Pill tone="muted">{t(STATE_LABEL[card.state])}</Pill>
                        <PriorityPill priority={card.priority} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}

/** A local calendar date as YYYY-MM-DD (the browser's own day, which is the person's). */
function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * CR-13 / D-097 b: the effort CSV needs a period - both dates are mandatory here and in the API.
 * The team/program filters of the progress report ride along; the server decides whose hours.
 */
function EffortCsvDialog({
  today,
  teamId,
  programId,
  onClose,
}: {
  today: string;
  teamId: string;
  programId: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [days, setDays] = useState('');
  const backwards = from !== '' && to !== '' && from > to;
  const ready = from !== '' && to !== '' && !backwards;
  /**
   * D-097 b: "Last X days ending today" - X days including today, where today is the server's
   * date in ORG_TZ (the one the page header shows). It only fills From/To; those stay editable and
   * are what is sent.
   */
  function lastDays(value: string) {
    setDays(value);
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 366) return;
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    setFrom(isoDay(new Date(y, m - 1, d - (n - 1))));
    setTo(today);
  }
  function download() {
    const qs = new URLSearchParams({
      from,
      to,
      ...(teamId ? { teamId } : {}),
      ...(programId ? { programId } : {}),
    });
    window.location.assign(`/api/v1/reports/effort.csv?${qs.toString()}`);
    ref.current?.close();
    onClose();
  }
  return (
    <dialog
      ref={ref}
      className={c.dialog}
      aria-labelledby="effort-csv-title"
      onClose={onClose}
      data-testid="effort-csv-dialog"
    >
      <form
        className={c.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) download();
        }}
      >
        <h2 id="effort-csv-title" className={c.dialogTitle}>
          {t('reports.effortCsv')}
        </h2>
        <p className={c.hint}>{t('reports.csv.lead')}</p>
        <label className={c.field}>
          <span>{t('reports.csv.lastDays')}</span>
          <input
            className={c.input}
            type="number"
            min={1}
            max={366}
            step={1}
            inputMode="numeric"
            value={days}
            onChange={(e) => lastDays(e.target.value)}
            data-testid="csv-last-days"
          />
          <span className={c.hint}>{t('reports.csv.lastDaysHint')}</span>
        </label>
        <div className={c.row}>
          <label className={c.field}>
            <span>{t('reports.csv.from')}</span>
            <input
              className={c.input}
              type="date"
              required
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="csv-from"
            />
          </label>
          <label className={c.field}>
            <span>{t('reports.csv.to')}</span>
            <input
              className={c.input}
              type="date"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="csv-to"
            />
          </label>
        </div>
        {backwards ? <Alert tone="danger">{t('reports.csv.backwards')}</Alert> : null}
        <div className={c.dialogActions}>
          <Button onClick={onClose}>{t('card.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!ready} data-testid="csv-download">
            {t('reports.csv.download')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
