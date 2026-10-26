// Report graphs (D-148, restyled D-153 to the user's mockup): drawn from the same rows the tables
// show - the server's numbers, never re-derived rules. Summary tiles, work items by state per
// group (stacked), planned against logged hours per group, and overdue cards per group. The
// tables stay the text view; every bar carries a tooltip and every chart a legend or a title
// naming its one series.
import { Icon, type IconName } from '../../components/Icon';
import { t } from '../../i18n/t';
import { cx } from '../../styles/cx';
import { STATE_LABEL } from '../cards/Board';
import type { CardState, ProgressRow } from '../cards/api';
import g from './reportCharts.module.css';

/** The states a progress row splits into, in workflow order (cancelled is kept apart, D-029). */
const SERIES: CardState[] = ['backlog', 'in_prep', 'ready', 'in_development', 'uat', 'delivered'];
/** Groups drawn per chart; the rest are in the table. */
const SHOWN = 12;

const count = (r: ProgressRow, st: CardState) =>
  st === 'delivered' ? r.delivered : (r.byState[st] ?? 0);
const total = (r: ProgressRow) => SERIES.reduce((n, st) => n + count(r, st), 0);
export const hours = (n: number) => (Math.round(n * 10) / 10).toString();

type Part = { key: string; value: number; color: string; tip: string };

/** Stacked: each part starts where the ones before it end. */
function Bar({ parts, max }: { parts: Part[]; max: number }) {
  const width = (v: number) => (max > 0 ? (v / max) * 100 : 0);
  const starts = parts.map((_, i) => parts.slice(0, i).reduce((x, q) => x + width(q.value), 0));
  return (
    <svg className={g.bar} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
      {parts.map((p, i) =>
        p.value > 0 ? (
          <rect
            key={p.key}
            x={starts[i]}
            y={0}
            width={width(p.value)}
            height={10}
            className={g.mark}
            style={{ fill: p.color }}
          >
            <title>{p.tip}</title>
          </rect>
        ) : null,
      )}
    </svg>
  );
}

/** Overlaid: every part starts at zero - planned behind, logged in front. */
function Overlay({ parts, max }: { parts: Part[]; max: number }) {
  const width = (v: number) => (max > 0 ? (v / max) * 100 : 0);
  return (
    <svg className={g.bar} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
      {parts.map((p, i) =>
        p.value > 0 ? (
          <rect
            key={p.key}
            x={0}
            y={i === 0 ? 0 : 2}
            width={width(p.value)}
            height={i === 0 ? 10 : 6}
            style={{ fill: p.color }}
          >
            <title>{p.tip}</title>
          </rect>
        ) : null,
      )}
    </svg>
  );
}

function More({ n }: { n: number }) {
  return n > 0 ? <p className={g.more}>{t('reports.chart.more', { n })}</p> : null;
}

function Legend({ items }: { items: { key: string; label: string; color: string }[] }) {
  return (
    <ul className={g.legend} aria-label={t('reports.chart.legend')}>
      {items.map((it) => (
        <li key={it.key} className={g.legendItem}>
          <span className={g.swatch} style={{ background: it.color }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export function ReportSummary({ rows }: { rows: ProgressRow[] }) {
  const sum = (f: (r: ProgressRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  const open = sum((r) => r.open);
  const delivered = sum((r) => r.delivered);
  const done = open + delivered > 0 ? Math.round((delivered / (open + delivered)) * 100) : 0;
  const overdue = sum((r) => r.overdue);
  const tiles: {
    key: string;
    label: string;
    value: string;
    icon: IconName;
    tone: 'accent' | 'success' | 'violet' | 'danger' | 'warning';
  }[] = [
    { key: 'open', label: t('reports.open'), value: String(open), icon: 'inbox', tone: 'accent' },
    {
      key: 'delivered',
      label: t('state.delivered'),
      value: String(delivered),
      icon: 'check',
      tone: 'success',
    },
    {
      key: 'done',
      label: t('reports.chart.completion'),
      value: `${done}%`,
      icon: 'chart',
      tone: 'violet',
    },
    {
      key: 'overdue',
      label: t('reports.overdue'),
      value: String(overdue),
      icon: 'warn',
      tone: 'danger',
    },
    {
      key: 'noEta',
      label: t('reports.chart.missingEta'),
      value: String(sum((r) => r.noEta)),
      icon: 'cal',
      tone: 'warning',
    },
    {
      key: 'hours',
      label: t('reports.chart.hours'),
      value: `${hours(sum((r) => r.loggedHours))} / ${hours(sum((r) => r.effortHours))} h`,
      icon: 'clock',
      tone: 'success',
    },
  ];
  return (
    <dl className={g.tiles} data-testid="report-summary">
      {tiles.map((tile) => (
        <div key={tile.key} className={g.tile} data-testid={`tile-${tile.key}`}>
          <span className={cx(g.tileIcon, g[`tone_${tile.tone}`])} aria-hidden="true">
            <Icon name={tile.icon} size={20} />
          </span>
          <span className={g.tileText}>
            <dt className={g.tileLabel}>{tile.label}</dt>
            <dd
              className={cx(
                tile.key === 'overdue' && overdue > 0 ? g.tileDanger : g.tileValue,
                tile.key === 'hours' && g.tileSmall,
              )}
            >
              {tile.value}
            </dd>
          </span>
        </div>
      ))}
    </dl>
  );
}

export function StateChart({ rows, groupLabel }: { rows: ProgressRow[]; groupLabel: string }) {
  const drawn = rows.filter((r) => total(r) > 0).sort((a, b) => total(b) - total(a));
  const shown = drawn.slice(0, SHOWN);
  const max = Math.max(0, ...shown.map(total));
  return (
    <figure className={g.chart} data-testid="chart-states">
      <figcaption className={g.head}>
        <span className={g.title}>{t('reports.chart.states')}</span>
        <span className={g.sub}>{t('reports.chart.statesSub', { group: groupLabel })}</span>
      </figcaption>
      <Legend
        items={SERIES.map((st) => ({
          key: st,
          label: t(STATE_LABEL[st]),
          color: `var(--s-${st})`,
        }))}
      />
      {shown.length === 0 ? <p className={g.more}>{t('reports.empty')}</p> : null}
      <ul className={g.rows}>
        {shown.map((r) => (
          <li
            key={r.id ?? 'none'}
            className={g.row}
            data-testid="chart-states-row"
            aria-label={t('reports.chart.statesRow', {
              name: r.name,
              parts: SERIES.map((st) => `${t(STATE_LABEL[st])} ${count(r, st)}`).join(', '),
            })}
          >
            <span className={g.label} title={r.name}>
              {r.name}
            </span>
            <Bar
              max={max}
              parts={SERIES.map((st) => ({
                key: st,
                value: count(r, st),
                color: `var(--s-${st})`,
                tip: `${r.name} · ${t(STATE_LABEL[st])}: ${count(r, st)}`,
              }))}
            />
            <span className={g.value}>{total(r)}</span>
          </li>
        ))}
      </ul>
      <More n={drawn.length - shown.length} />
    </figure>
  );
}

/** Round hour marks for the axis: 0 and four steps up to at least the largest value. */
function ticks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

export function EffortChart({ rows, groupLabel }: { rows: ProgressRow[]; groupLabel: string }) {
  const drawn = rows
    .filter((r) => r.effortHours > 0 || r.loggedHours > 0)
    .sort(
      (a, b) => Math.max(b.effortHours, b.loggedHours) - Math.max(a.effortHours, a.loggedHours),
    );
  const shown = drawn.slice(0, SHOWN);
  const top = ticks(Math.max(0, ...shown.map((r) => Math.max(r.effortHours, r.loggedHours))));
  const max = top[top.length - 1] ?? 0;
  const planned = { label: t('reports.chart.effort'), color: 'var(--s-effort)' };
  const logged = { label: t('reports.chart.logged'), color: 'var(--s-logged)' };
  return (
    <figure className={g.chart} data-testid="chart-effort">
      <figcaption className={g.head}>
        <span className={g.title}>{t('reports.chart.effortTitle')}</span>
        <span className={g.sub}>{t('reports.chart.effortSub', { group: groupLabel })}</span>
      </figcaption>
      {shown.length === 0 ? (
        <p className={g.more}>{t('reports.chart.noHours')}</p>
      ) : (
        <>
          <Legend
            items={[
              { key: 'effort', ...planned },
              { key: 'logged', ...logged },
            ]}
          />
          <ul className={g.rows}>
            {shown.map((r) => {
              const over = r.loggedHours > r.effortHours;
              return (
                <li
                  key={r.id ?? 'none'}
                  className={g.row}
                  data-testid="chart-effort-row"
                  aria-label={t('reports.chart.effortRow', {
                    name: r.name,
                    effort: hours(r.effortHours),
                    logged: hours(r.loggedHours),
                  })}
                >
                  <span className={g.label} title={r.name}>
                    {r.name}
                  </span>
                  <Overlay
                    max={max}
                    parts={[
                      {
                        key: 'effort',
                        value: r.effortHours,
                        color: planned.color,
                        tip: `${r.name} · ${planned.label}: ${hours(r.effortHours)} h`,
                      },
                      {
                        key: 'logged',
                        value: r.loggedHours,
                        color: logged.color,
                        tip: `${r.name} · ${logged.label}: ${hours(r.loggedHours)} h`,
                      },
                    ]}
                  />
                  <span
                    className={over ? g.over : g.value}
                    title={over ? t('reports.chart.overTip') : undefined}
                  >
                    {`${hours(r.loggedHours)} / ${hours(r.effortHours)} h`}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className={g.axisRow} aria-hidden="true">
            <span />
            <span className={g.axis}>
              {top.map((v) => (
                <span key={v} className={g.tick} style={{ left: `${max ? (v / max) * 100 : 0}%` }}>
                  {v}
                </span>
              ))}
            </span>
            <span />
          </div>
          <p className={g.axisLabel}>{t('reports.chart.hoursAxis')}</p>
          <More n={drawn.length - shown.length} />
        </>
      )}
    </figure>
  );
}

export function OverdueChart({
  groups,
}: {
  groups: { id: string | null; name: string; n: number }[];
}) {
  const drawn = [...groups].sort((a, b) => b.n - a.n);
  const shown = drawn.slice(0, SHOWN);
  const max = Math.max(0, ...shown.map((x) => x.n));
  return (
    <figure className={g.chart} data-testid="chart-overdue">
      <figcaption className={g.head}>
        <span className={g.title}>{t('reports.chart.overdue')}</span>
      </figcaption>
      <ul className={g.rows}>
        {shown.map((x) => (
          <li
            key={x.id ?? 'none'}
            className={g.row}
            data-testid="chart-overdue-row"
            aria-label={t('reports.chart.overdueRow', { name: x.name, n: x.n })}
          >
            <span className={g.label} title={x.name}>
              {x.name}
            </span>
            <Bar
              max={max}
              parts={[
                {
                  key: 'n',
                  value: x.n,
                  color: 'var(--color-danger)',
                  tip: `${x.name} · ${t('reports.overdue')}: ${x.n}`,
                },
              ]}
            />
            <span className={g.value}>{x.n}</span>
          </li>
        ))}
      </ul>
      <More n={drawn.length - shown.length} />
    </figure>
  );
}
