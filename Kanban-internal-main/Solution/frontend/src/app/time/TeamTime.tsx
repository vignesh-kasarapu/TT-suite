// Team time (D-116, FR-083): for a team I lead (any team, for an admin), each member's hours per
// day, the week total against their target, days off and note, and their entries on this team's
// cards. Other teams' work arrives from the server as one figure; the page never sees its detail.
// Members who are short are listed first - the order a lead works through them.
// D-156 (the user's mockup): KPI tiles with bars, a searchable members table (Group by status,
// Variance, Days off, a "..." menu that shows the member's work), team hours against target,
// each member's share, and one work table with search, member and status filters, an Export
// menu (the server's team CSV, the members table and the work log as shown).
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Avatar } from '../../components/Avatar';
import { Icon, type IconName } from '../../components/Icon';
import b from '../../components/components.module.css';
import { Alert, EmptyState, Pill, ResponsiveList, Skeleton } from '../../components';
import { t } from '../../i18n/t';
import { cx } from '../../styles/cx';
import { pageTitleClass } from '../Shell';
import c from '../cards/cards.module.css';
import { STATES } from '../cards/api';
import { STATE_LABEL } from '../cards/Board';
import { Pager } from '../cards/Pager';
import { addDays, useTeamWeek, useTimeTeams, type TeamMemberWeek } from './api';
import { Bar, PeriodNav, dayLabel, dayShort, rangeLabel, todayIso, usePeriod } from './parts';
import s from './time.module.css';

const DAY_KEYS = ['time.mon', 'time.tue', 'time.wed', 'time.thu', 'time.fri'] as const;

function DayCell({ m, i, today }: { m: TeamMemberWeek; i: number; today: string }) {
  const d = m.days[i];
  if (!d) return null;
  if (d.dayOff)
    return (
      <span className={s.cellOff}>{t(d.dayOff === 'leave' ? 'time.leave' : 'time.holiday')}</span>
    );
  // A day still to come is not short yet.
  if (d.date > today && d.hours === 0)
    return (
      <span className={s.cellOff} title={t('teamTime.upcoming')}>
        {'–'}
      </span>
    );
  return (
    <span className={cx(d.hours < d.target && d.date < today && s.cellShort)}>
      {String(d.hours)}
    </span>
  );
}

/** D-120: in a month, one column per week - the member's hours that week, days off noted. */
function WeekCell({ m, dates, today }: { m: TeamMemberWeek; dates: string[]; today: string }) {
  const days = m.days.filter((d) => dates.includes(d.date));
  const hours = Math.round(days.reduce((n, d) => n + d.hours, 0) * 100) / 100;
  const target = days.reduce((n, d) => n + d.target, 0);
  const off = days.filter((d) => d.dayOff).length;
  if ((dates[0] ?? '') > today && hours === 0)
    return (
      <span className={s.cellOff} title={t('teamTime.upcoming')}>
        {'–'}
      </span>
    );
  return (
    <span
      className={cx(hours < target && (dates[dates.length - 1] ?? '') < today && s.cellShort)}
      title={t('time.ofTarget', { total: String(hours), target: String(target) })}
    >
      {String(hours)}
      {off ? (
        <span className={s.cellOff}>{` (${t('teamTime.offDays', { n: String(off) })})`}</span>
      ) : null}
    </span>
  );
}

/** The working days of a period split into weeks (Monday starts a new one). */
function weeksOf(dates: string[]): string[][] {
  const weeks: string[][] = [];
  for (const d of dates) {
    const last = weeks[weeks.length - 1];
    if (!last || new Date(`${d}T00:00:00Z`).getUTCDay() === 1) weeks.push([d]);
    else last.push(d);
  }
  return weeks;
}

/** "Short" first (who needs a look), then on target - D-156's "Group by: Status". */
type GroupBy = 'none' | 'status';

/** One CSV field, quoted, with a leading = + - @ neutralised (the server's formula guard). */
function csvField(value: string | number): string {
  let v = String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}
function downloadCsv(name: string, lines: (string | number)[][]) {
  const body = lines.map((l) => l.map(csvField).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${body}\r\n`], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const round = (n: number) => Math.round(n * 100) / 100;
const MEMBER_COLOURS = 6;

/** KPI tile: icon, label, value, and a bar when there is a share to show. */
function Kpi({
  icon,
  tone,
  label,
  value,
  pct,
  danger,
  sub,
  testId,
}: {
  icon: IconName;
  tone: string;
  label: string;
  value: string;
  pct?: number;
  danger?: boolean;
  sub?: string;
  testId: string;
}) {
  return (
    <li className={s.kpi} data-testid={testId}>
      <span className={cx(s.kpiIcon, s[`kpi_${tone}`])} aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <span className={s.kpiBody}>
        <span className={s.kpiLabel}>{label}</span>
        <span className={s.kpiValue}>{value}</span>
        {pct !== undefined ? (
          <span className={s.kpiBarRow}>
            <span className={s.kpiTrack}>
              <span
                className={cx(s.kpiFill, danger && s.kpiFillDanger)}
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              />
            </span>
            <span className={s.kpiPct}>{`${Math.round(pct)}%`}</span>
          </span>
        ) : null}
        {sub ? <span className={s.kpiSub}>{sub}</span> : null}
      </span>
    </li>
  );
}

/** Logged against target for the team, per day (week) or per week (month). */
function TeamHoursChart({ members, month }: { members: TeamMemberWeek[]; month: boolean }) {
  const dates = (members[0]?.days ?? []).map((d) => d.date);
  const groups = month ? weeksOf(dates) : dates.map((d) => [d]);
  const pts = groups.map((g, i) => {
    let hours = 0;
    let target = 0;
    for (const m of members)
      for (const d of m.days)
        if (g.includes(d.date)) {
          hours += d.hours;
          target += d.target;
        }
    return {
      key: g[0] ?? String(i),
      label: month ? t('time.weekN', { n: String(i + 1) }) : dayShort(g[0] ?? ''),
      hours: round(hours),
      target,
    };
  });
  const top = Math.max(1, ...pts.map((p) => Math.max(p.hours, p.target)));
  const step = top <= 40 ? 10 : top <= 100 ? 20 : 50;
  const max = Math.ceil(top / step) * step;
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);
  const W = 640;
  const H = 180;
  const L = 40;
  const B = 26;
  const slot = (W - L - 10) / Math.max(1, pts.length);
  const bar = Math.min(28, slot / 3);
  const y = (v: number) => 8 + (1 - v / max) * (H - 8 - B);
  return (
    <figure className={s.chartCard} data-testid="team-hours-chart">
      <figcaption className={s.chartHead}>
        <span className={s.panelTitle}>{t('teamTime.hoursVsTarget')}</span>
        <span className={s.chartLegend}>
          <span className={cx(s.swatch, s.swatchLogged)} />
          {t('teamTime.loggedHours')}
          <span className={cx(s.swatch, s.swatchTarget)} />
          {t('teamTime.targetHours')}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={s.breakdownSvg}
        role="img"
        aria-labelledby="th-desc"
      >
        <desc id="th-desc">
          {pts
            .map(
              (p) =>
                `${p.label}: ${t('time.ofTarget', { total: String(p.hours), target: String(p.target) })}`,
            )
            .join(', ')}
        </desc>
        {ticks.map((v) => (
          <g key={v}>
            <line className={s.gridLine} x1={L} x2={W - 10} y1={y(v)} y2={y(v)} />
            <text className={s.axisText} x={L - 6} y={y(v) + 4} textAnchor="end">
              {`${v}h`}
            </text>
          </g>
        ))}
        {pts.map((p, i) => {
          const cx0 = L + slot * i + slot / 2;
          return (
            <g key={p.key}>
              <rect
                className={s.barLogged}
                x={cx0 - bar - 2}
                y={y(p.hours)}
                width={bar}
                height={Math.max(0, H - B - y(p.hours))}
                rx={3}
              >
                <title>{`${p.label} · ${t('teamTime.loggedHours')}: ${p.hours} h`}</title>
              </rect>
              <rect
                className={s.barTarget}
                x={cx0 + 2}
                y={y(p.target)}
                width={bar}
                height={Math.max(0, H - B - y(p.target))}
                rx={3}
              >
                <title>{`${p.label} · ${t('teamTime.targetHours')}: ${p.target} h`}</title>
              </rect>
              <text className={s.axisText} x={cx0} y={H - 8} textAnchor="middle">
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Each member's share of the team's hours as a donut (first six by hours, the rest folded). */
function Contribution({
  members,
  logged,
  target,
}: {
  members: TeamMemberWeek[];
  logged: number;
  target: number;
}) {
  const ranked = [...members].filter((m) => m.total > 0).sort((a, b) => b.total - a.total);
  const shown = ranked.slice(0, MEMBER_COLOURS);
  const rest = ranked.slice(MEMBER_COLOURS).reduce((n, m) => n + m.total, 0);
  const parts = [
    ...shown.map((m, i) => ({
      key: m.user.id,
      name: m.user.name,
      hours: m.total,
      colour: `var(--chart-${i + 1})`,
    })),
    ...(rest > 0
      ? [{ key: 'rest', name: t('teamTime.others'), hours: rest, colour: 'var(--color-border)' }]
      : []),
  ];
  const r = 52;
  const len = 2 * Math.PI * r;
  let offset = 0;
  return (
    <figure className={s.chartCard} data-testid="team-contribution">
      <figcaption className={s.chartHead}>
        <span className={s.panelTitle}>{t('teamTime.contribution')}</span>
      </figcaption>
      <div className={s.donutRow}>
        <svg
          viewBox="0 0 140 140"
          className={s.donut}
          role="img"
          aria-label={t('time.ofTarget', { total: String(round(logged)), target: String(target) })}
        >
          <circle className={s.ringTrack} cx={70} cy={70} r={r} />
          {parts.map((p) => {
            const share = logged > 0 ? p.hours / logged : 0;
            const dash = `${len * share} ${len}`;
            const el = (
              <circle
                key={p.key}
                cx={70}
                cy={70}
                r={r}
                fill="none"
                strokeWidth={14}
                style={{ stroke: p.colour }}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
              >
                <title>{`${p.name}: ${round(p.hours)} h`}</title>
              </circle>
            );
            offset += len * share;
            return el;
          })}
          <text className={s.donutBig} x={70} y={70} textAnchor="middle">
            {`${round(logged)} h`}
          </text>
          <text className={s.axisText} x={70} y={88} textAnchor="middle">
            {t('teamTime.ofHours', { n: String(target) })}
          </text>
        </svg>
        <ul className={s.donutLegend}>
          {parts.length === 0 ? <li className={s.panelHint}>{t('teamTime.noHoursYet')}</li> : null}
          {parts.map((p) => (
            <li key={p.key} className={s.donutItem}>
              <span className={s.swatch} style={{ background: p.colour }} />
              <span className={s.donutName}>{p.name}</span>
              <span className={s.donutValue}>
                {`${round(p.hours)} h (${logged > 0 ? Math.round((p.hours / logged) * 100) : 0}%)`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

export function TeamTime() {
  const [params, setParams] = useSearchParams();
  const teams = useTimeTeams();
  const items = teams.data?.items ?? [];
  const teamId = params.get('team') || items[0]?.id || '';
  const period = usePeriod();
  const data = useTeamWeek(teamId, period.week, period.month);
  const wk = data.data;
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [cardSearch, setCardSearch] = useState('');
  const [workMember, setWorkMember] = useState('');
  const [workState, setWorkState] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const exportRef = useRef<HTMLDetailsElement>(null);
  const workRef = useRef<HTMLElement>(null);
  const members = [...(wk?.members ?? [])].sort(
    (a, b) => b.shortBy - a.shortBy || a.user.name.localeCompare(b.user.name),
  );
  const logged = members.reduce((n, m) => n + m.total, 0);
  const target = members.reduce((n, m) => n + m.target, 0);
  const onTarget = members.filter((m) => m.shortBy === 0).length;
  const shortHours = members.reduce((n, m) => n + m.shortBy, 0);
  const offOf = (m: TeamMemberWeek) => m.days.filter((d) => d.dayOff).length;
  const daysOff = members.reduce((n, m) => n + offOf(m), 0);
  const offMembers = members.filter((m) => offOf(m) > 0).length;
  const today = todayIso();
  const month = wk?.period === 'month';
  const dates = (members[0]?.days ?? []).map((d) => d.date);
  const shown = members.filter((m) =>
    m.user.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const groups: { key: string; label: string; rows: TeamMemberWeek[] }[] =
    groupBy === 'status'
      ? [
          {
            key: 'short',
            label: t('teamTime.groupShort'),
            rows: shown.filter((m) => m.shortBy > 0),
          },
          {
            key: 'ok',
            label: t('teamTime.groupOnTarget'),
            rows: shown.filter((m) => m.shortBy === 0),
          },
        ].filter((g) => g.rows.length > 0)
      : [{ key: 'all', label: '', rows: shown }];

  // The work table: this team's entries of every member, newest day first.
  const work = members
    .flatMap((m) => m.entries.map((e) => ({ e, m })))
    .filter(
      ({ e, m }) =>
        (!workMember || m.user.id === workMember) && (!workState || e.card.state === workState),
    )
    .filter(({ e }) => {
      const q = cardSearch.trim().toLowerCase();
      return !q || e.card.key.toLowerCase().includes(q) || e.card.title.toLowerCase().includes(q);
    })
    .sort((a, b) => b.e.date.localeCompare(a.e.date) || a.m.user.name.localeCompare(b.m.user.name));
  const pages = Math.max(1, Math.ceil(work.length / size));
  const current = Math.min(page, pages);
  const workRows = work.slice((current - 1) * size, current * size);

  const variance = (m: TeamMemberWeek) => round(m.total - m.target);
  const showWork = (id: string) => {
    setWorkMember(id);
    setPage(1);
    workRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const dayHeaders = month
    ? weeksOf(dates).map((g, i) => ({
        key: `w-${g[0]}`,
        label: t('time.weekN', { n: String(i + 1) }),
        range: rangeLabel(g),
      }))
    : DAY_KEYS.map((k, i) => ({
        key: k,
        label: dayShort(addDays(wk?.weekStart ?? today, i)),
        range: '',
      }));

  function exportMembers() {
    exportRef.current?.removeAttribute('open');
    if (!wk) return;
    downloadCsv(`team-members-${wk.teamName}-${wk.start}.csv`, [
      [
        t('teamTime.member'),
        ...dayHeaders.map((h) => (h.range ? `${h.label} ${h.range}` : h.label)),
        t('teamTime.total'),
        t('teamTime.target'),
        t('teamTime.variance'),
        t('teamTime.otherTeams'),
        t('time.daysOff'),
        t('teamTime.note'),
      ],
      ...members.map((m) => [
        m.user.name,
        ...(month
          ? weeksOf(dates).map((g) =>
              round(m.days.filter((d) => g.includes(d.date)).reduce((n, d) => n + d.hours, 0)),
            )
          : m.days.map((d) =>
              d.dayOff ? t(d.dayOff === 'leave' ? 'time.leave' : 'time.holiday') : d.hours,
            )),
        m.total,
        m.target,
        variance(m),
        m.otherTeamsHours,
        offOf(m),
        m.note,
      ]),
    ]);
  }
  function exportWork() {
    exportRef.current?.removeAttribute('open');
    if (!wk) return;
    downloadCsv(`team-work-${wk.teamName}-${wk.start}.csv`, [
      [
        t('teamTime.date'),
        t('teamTime.member'),
        t('reports.csv.key'),
        t('backlog.col.title'),
        t('backlog.col.status'),
        t('time.hours'),
        t('teamTime.note'),
      ],
      ...work.map(({ e, m }) => [
        e.date,
        m.user.name,
        e.card.key,
        e.card.title,
        t(STATE_LABEL[e.card.state]),
        e.hours,
        e.note,
      ]),
    ]);
  }

  const membersTable = (rows: TeamMemberWeek[]) => (
    <ResponsiveList
      caption={t('teamTime.table', { team: wk?.teamName ?? '' })}
      rows={rows}
      rowKey={(m) => m.user.id}
      emptyText={t('teamTime.noMembers')}
      columns={[
        {
          key: 'member',
          header: t('teamTime.member'),
          cell: (m) => (
            <span className={s.member} data-testid={`member-${m.user.id}`}>
              <Avatar user={m.user} size={32} />
              <span className={s.memberName}>{m.user.name}</span>
              {m.isLead ? <Pill tone="muted">{t('teamTime.leadPill')}</Pill> : null}
            </span>
          ),
        },
        ...(month
          ? weeksOf(dates).map((g, i) => ({
              key: `w-${g[0]}`,
              header: (
                <span className={s.weekHead}>
                  {t('time.weekN', { n: String(i + 1) })}
                  <span className={s.segRange}>{rangeLabel(g)}</span>
                </span>
              ),
              numeric: true,
              cell: (m: TeamMemberWeek) => <WeekCell m={m} dates={g} today={today} />,
            }))
          : DAY_KEYS.map((name, i) => ({
              key: name,
              header: dayShort(addDays(wk?.weekStart ?? today, i)),
              numeric: true,
              cell: (m: TeamMemberWeek) => <DayCell m={m} i={i} today={today} />,
            }))),
        {
          key: 'total',
          header: t('teamTime.total'),
          cell: (m) => (
            <span className={s.totalCell}>
              <span className={s.totalText}>{t('time.hoursShort', { n: String(m.total) })}</span>
              <Bar value={m.total} max={m.target} small />
            </span>
          ),
        },
        {
          key: 'target',
          header: t('teamTime.target'),
          numeric: true,
          cell: (m) => t('time.hoursShort', { n: String(m.target) }),
        },
        {
          key: 'variance',
          header: t('teamTime.variance'),
          numeric: true,
          cell: (m) => {
            const v = variance(m);
            return (
              <span className={cx(v < 0 && s.cellShort, v >= 0 && s.doneText)}>
                {`${v > 0 ? '+' : ''}${v} h`}
              </span>
            );
          },
        },
        {
          key: 'other',
          header: t('teamTime.otherTeams'),
          numeric: true,
          cell: (m) => String(m.otherTeamsHours),
        },
        { key: 'off', header: t('time.daysOff'), numeric: true, cell: (m) => String(offOf(m)) },
        {
          key: 'note',
          header: t('teamTime.note'),
          cell: (m) =>
            m.note ? (
              <span className={s.note} title={m.note}>
                {m.note}
              </span>
            ) : (
              <span className={s.cellOff}>{t('teamTime.noNote')}</span>
            ),
        },
        {
          key: 'menu',
          header: <span className="visually-hidden">{t('backlog.col.actions')}</span>,
          cell: (m) => (
            <details className={c.cardMenu} data-popover data-testid={`member-menu-${m.user.id}`}>
              <summary
                className={c.cardMenuButton}
                aria-label={t('teamTime.memberActions', { name: m.user.name })}
                title={t('teamTime.memberActions', { name: m.user.name })}
              >
                <Icon name="more" size={18} />
              </summary>
              <div className={c.cardMenuPanel}>
                <button
                  type="button"
                  className={s.menuItem}
                  onClick={(e) => {
                    e.currentTarget.closest('details')?.removeAttribute('open');
                    showWork(m.user.id);
                  }}
                  data-testid={`show-work-${m.user.id}`}
                >
                  {t('teamTime.showWork')}
                </button>
              </div>
            </details>
          ),
        },
      ]}
    />
  );

  return (
    <div className={c.page} data-testid="team-time">
      <div className={s.head}>
        <div className={s.headText}>
          <h1 className={pageTitleClass}>{t('teamTime.title')}</h1>
          <p className={s.lead}>{t('teamTime.lead')}</p>
        </div>
        <div className={s.toolbar}>
          <label className={s.teamPick}>
            <Icon name="users" size={18} />
            <span className="visually-hidden">{t('card.team')}</span>
            <select
              className={c.input}
              value={teamId}
              onChange={(e) => {
                setParams({ team: e.target.value });
                setWorkMember('');
              }}
              data-testid="team-time-team"
            >
              {items.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </select>
          </label>
          <PeriodNav
            view={period.view}
            start={wk?.start}
            current={period.current}
            {...period.nav(wk?.start)}
          />
          {wk ? (
            <details
              ref={exportRef}
              className={s.exportMenu}
              data-popover
              data-testid="team-export"
            >
              <summary className={s.exportButton} data-testid="team-export-open">
                <Icon name="download" size={18} />
                {t('reports.export')}
                <Icon name="down" size={16} />
              </summary>
              <div className={s.exportPanel}>
                {/* D-140: the shown week or month as an Excel-ready CSV (the server checks who may). */}
                <a
                  href={`/api/v1/teams/${teamId}/time.csv?${period.month ? `month=${period.month}` : `week=${wk.start}`}`}
                  download
                  onClick={() => exportRef.current?.removeAttribute('open')}
                  data-testid="team-time-download"
                >
                  {t('teamTime.download')}
                </a>
                <button type="button" onClick={exportMembers} data-testid="export-members">
                  {t('teamTime.exportMembers')}
                </button>
                <button type="button" onClick={exportWork} data-testid="export-work">
                  {t('teamTime.exportWork')}
                </button>
              </div>
            </details>
          ) : null}
        </div>
      </div>
      {teams.isSuccess && items.length === 0 ? (
        <EmptyState title={t('teamTime.noTeams')} body={t('teamTime.noTeamsBody')} />
      ) : data.isError ? (
        <Alert tone="danger">{t('error.body')}</Alert>
      ) : data.isPending || !wk ? (
        <Skeleton lines={5} label={t('card.loading')} />
      ) : (
        <>
          <ul className={s.kpis} aria-label={t('teamTime.summary', { team: wk.teamName })}>
            <Kpi
              testId="kpi-hours"
              icon="users"
              tone="blue"
              label={t('teamTime.kpiLogged')}
              value={t('time.ofTarget', {
                total: String(round(logged)),
                target: String(round(target)),
              })}
              pct={target > 0 ? (logged / target) * 100 : 0}
            />
            <Kpi
              testId="kpi-on-target"
              icon="check"
              tone="pink"
              label={t('teamTime.kpiOnTarget')}
              value={t('teamTime.ofMembers', { n: String(onTarget), of: String(members.length) })}
              pct={members.length > 0 ? (onTarget / members.length) * 100 : 0}
            />
            <Kpi
              testId="kpi-short"
              icon="clock"
              tone="orange"
              label={t('teamTime.kpiShort')}
              value={t('time.hoursShort', { n: String(round(shortHours)) })}
              pct={target > 0 ? (shortHours / target) * 100 : 0}
              danger
            />
            <Kpi
              testId="kpi-days-off"
              icon="cal"
              tone="violet"
              label={t('teamTime.kpiDaysOff')}
              value={String(daysOff)}
              sub={t('teamTime.membersOff', { n: String(offMembers) })}
            />
          </ul>

          <section className={s.panel} aria-labelledby="team-week">
            <div className={s.panelHead}>
              <div>
                <h2 id="team-week" className={s.panelTitle}>
                  {t('teamTime.members')}
                </h2>
                <p className={s.panelHint}>
                  {t(month ? 'teamTime.monthlyFor' : 'teamTime.weeklyFor', {
                    range: `${dayLabel(wk.start)} – ${dayLabel(wk.end)}`,
                  })}
                </p>
              </div>
              <span className={s.panelTools}>
                <label className={s.searchBox}>
                  <Icon name="search" size={18} />
                  <input
                    type="search"
                    className={s.searchInput}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('teamTime.searchMembers')}
                    aria-label={t('teamTime.searchMembers')}
                    data-testid="member-search"
                  />
                </label>
                <label className={s.groupPick}>
                  <span>{t('time.groupBy')}</span>
                  <select
                    className={c.input}
                    value={groupBy}
                    onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                    data-testid="member-group"
                  >
                    <option value="none">{t('teamTime.groupNone')}</option>
                    <option value="status">{t('teamTime.groupStatus')}</option>
                  </select>
                </label>
              </span>
            </div>
            {groups.length === 0 ? <p className={s.panelHint}>{t('teamTime.noMembers')}</p> : null}
            {groups.map((g) => (
              <div key={g.key} className={s.memberGroup} data-testid={`member-group-${g.key}`}>
                {g.label ? (
                  <h3 className={s.groupHead}>{`${g.label} · ${g.rows.length}`}</h3>
                ) : null}
                {membersTable(g.rows)}
              </div>
            ))}
          </section>

          <div className={s.chartRow}>
            <TeamHoursChart members={members} month={month} />
            <Contribution members={members} logged={logged} target={target} />
          </div>

          <section
            ref={workRef}
            className={s.panel}
            aria-labelledby="team-work"
            data-testid="team-work"
          >
            <div className={s.panelHead}>
              <div>
                <h2 id="team-work" className={s.panelTitle}>
                  {t('teamTime.work', { team: wk.teamName })}
                </h2>
                <p className={s.panelHint}>{t('teamTime.workLead')}</p>
              </div>
              <span className={s.panelTools}>
                <label className={s.searchBox}>
                  <Icon name="search" size={18} />
                  <input
                    type="search"
                    className={s.searchInput}
                    value={cardSearch}
                    onChange={(e) => {
                      setCardSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder={t('teamTime.searchCards')}
                    aria-label={t('teamTime.searchCards')}
                    data-testid="work-search"
                  />
                </label>
                <select
                  className={c.input}
                  value={workMember}
                  onChange={(e) => {
                    setWorkMember(e.target.value);
                    setPage(1);
                  }}
                  aria-label={t('teamTime.member')}
                  data-testid="work-member"
                >
                  <option value="">{t('teamTime.allMembers')}</option>
                  {members.map((m) => (
                    <option key={m.user.id} value={m.user.id}>
                      {m.user.name}
                    </option>
                  ))}
                </select>
                <select
                  className={c.input}
                  value={workState}
                  onChange={(e) => {
                    setWorkState(e.target.value);
                    setPage(1);
                  }}
                  aria-label={t('backlog.col.status')}
                  data-testid="work-state"
                >
                  <option value="">{t('teamTime.allStatus')}</option>
                  {STATES.map((st) => (
                    <option key={st} value={st}>
                      {t(STATE_LABEL[st])}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={cx(b.btn, b.secondary)}
                  onClick={exportWork}
                  data-testid="work-export"
                >
                  <Icon name="download" size={18} />
                  {t('reports.export')}
                </button>
              </span>
            </div>
            <ResponsiveList
              caption={t('teamTime.work', { team: wk.teamName })}
              rows={workRows}
              rowKey={({ e }) => e.id}
              emptyText={t('teamTime.noWork')}
              columns={[
                {
                  key: 'date',
                  header: t('teamTime.date'),
                  cell: ({ e }) => <span className={s.nowrap}>{dayLabel(e.date)}</span>,
                },
                {
                  key: 'member',
                  header: t('teamTime.member'),
                  cell: ({ m }) => (
                    <span className={s.member}>
                      <Avatar user={m.user} size={24} />
                      {m.user.name}
                    </span>
                  ),
                },
                {
                  key: 'card',
                  header: t('reports.csv.key'),
                  cell: ({ e }) => (
                    <span className={s.workCard} data-testid="team-entry">
                      <span className={s.key}>{e.card.key}</span>
                      <Link
                        to={`/cards/${e.card.key}`}
                        className={s.entryTitle}
                        title={e.card.title}
                      >
                        {e.card.title}
                      </Link>
                      {e.note ? <span className={s.entryNote}>{e.note}</span> : null}
                    </span>
                  ),
                },
                {
                  key: 'state',
                  header: t('backlog.col.status'),
                  cell: ({ e }) => (
                    <span className={s.statePill}>{t(STATE_LABEL[e.card.state])}</span>
                  ),
                },
                {
                  key: 'hours',
                  header: t('time.hours'),
                  numeric: true,
                  cell: ({ e }) => t('time.hoursShort', { n: String(e.hours) }),
                },
              ]}
            />
            <Pager
              page={current}
              size={size}
              total={work.length}
              showing={(from, to, n) => t('teamTime.showing', { from, to, n })}
              onPage={setPage}
              onSize={(n) => {
                setSize(n);
                setPage(1);
              }}
              idPrefix="work"
              pagePrefix="work-"
            />
          </section>
        </>
      )}
    </div>
  );
}
