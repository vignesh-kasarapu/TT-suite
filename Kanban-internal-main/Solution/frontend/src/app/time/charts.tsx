// My time's two small graphs (D-154): the progress ring around the period total and the
// breakdown line - hours per day (a week) or per week (a month) - drawn from the days the server
// sent. Display only: totals and targets are the server's.
import { t } from '../../i18n/t';
import type { TimeDay } from './api';
import { dayShort, rangeLabel } from './parts';
import s from './time.module.css';

export function Ring({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const r = 34;
  const len = 2 * Math.PI * r;
  return (
    <svg
      className={s.ring}
      viewBox="0 0 80 80"
      role="img"
      aria-label={t('time.ofTarget', { total: String(value), target: String(max) })}
      data-testid="time-ring"
    >
      <circle className={s.ringTrack} cx={40} cy={40} r={r} />
      {pct > 0 ? (
        <circle
          className={pct >= 1 ? s.ringDone : s.ringFill}
          cx={40}
          cy={40}
          r={r}
          strokeDasharray={`${len * pct} ${len}`}
          transform="rotate(-90 40 40)"
        />
      ) : null}
    </svg>
  );
}

/** A week's days, or a month's weeks (Monday starts one), as points with their target. */
function points(days: TimeDay[], month: boolean) {
  if (!month)
    return days.map((d) => ({
      key: d.date,
      label: dayShort(d.date),
      hours: d.hours,
      target: d.target,
    }));
  const weeks: TimeDay[][] = [];
  for (const d of days) {
    const last = weeks[weeks.length - 1];
    if (!last || new Date(`${d.date}T00:00:00Z`).getUTCDay() === 1) weeks.push([d]);
    else last.push(d);
  }
  return weeks.map((w, i) => ({
    key: w[0]!.date,
    label: `${t('time.weekN', { n: String(i + 1) })} · ${rangeLabel(w.map((d) => d.date))}`,
    hours: Math.round(w.reduce((n, d) => n + d.hours, 0) * 100) / 100,
    target: w.reduce((n, d) => n + d.target, 0),
  }));
}

const W = 700;
const H = 180;
const PAD = { l: 36, r: 16, t: 10, b: 28 };

export function Breakdown({ days, month }: { days: TimeDay[]; month: boolean }) {
  const pts = points(days, month);
  const top = Math.max(month ? 40 : 8, ...pts.map((p) => p.hours), ...pts.map((p) => p.target));
  const step = month ? 10 : 2;
  const max = Math.ceil(top / step) * step;
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);
  const x = (i: number) =>
    PAD.l +
    (pts.length <= 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (pts.length - 1));
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.hours)}`).join(' ');
  return (
    <figure className={s.breakdown} data-testid="time-breakdown">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={s.breakdownSvg}
        role="img"
        aria-labelledby="bd-desc"
      >
        <desc id="bd-desc">
          {pts.map((p) => `${p.label}: ${t('time.hoursShort', { n: String(p.hours) })}`).join(', ')}
        </desc>
        {ticks.map((v) => (
          <g key={v}>
            <line className={s.gridLine} x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
            <text className={s.axisText} x={PAD.l - 6} y={y(v) + 4} textAnchor="end">
              {`${v}h`}
            </text>
          </g>
        ))}
        {pts.map((p, i) => (
          <line
            key={`target-${p.key}`}
            className={s.targetTick}
            x1={x(i) - 10}
            x2={x(i) + 10}
            y1={y(p.target)}
            y2={y(p.target)}
          />
        ))}
        <path className={s.trend} d={line} />
        {pts.map((p, i) => (
          <g key={p.key}>
            <circle className={s.dot} cx={x(i)} cy={y(p.hours)} r={5}>
              <title>{`${p.label}: ${t('time.ofTarget', { total: String(p.hours), target: String(p.target) })}`}</title>
            </circle>
            <text className={s.axisText} x={x(i)} y={H - 8} textAnchor="middle">
              {month ? t('time.weekN', { n: String(i + 1) }) : p.label}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className={s.breakdownKey}>
        <span className={s.keyLine} aria-hidden="true" />
        {t('time.keyLogged')}
        <span className={s.keyTarget} aria-hidden="true" />
        {t('time.keyTarget')}
      </figcaption>
    </figure>
  );
}
