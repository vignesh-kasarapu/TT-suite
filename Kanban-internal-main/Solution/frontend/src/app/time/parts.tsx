// Pieces shared by My time and Team time (D-116): the week switcher, a progress bar and date
// labels. Dates are ISO calendar days from the server; they are formatted in UTC so a browser in
// another time zone never shifts them by a day.
import { t } from '../../i18n/t';
import { cx } from '../../styles/cx';
import { useState } from 'react';
import { addDays, addMonths } from './api';
import s from './time.module.css';

const DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const WEEKDAY_DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const at = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** "Mon 15 Jun" */
export function dayLabel(iso: string): string {
  return DAY.format(at(iso));
}
/** "Mon 15" (table headers) */
export function dayShort(iso: string): string {
  return WEEKDAY_DAY.format(at(iso));
}
/** "1 – 2 Oct" or "5 – 9 Oct" for the working days of one week of a month (D-122). */
export function rangeLabel(dates: string[]): string {
  const first = dates[0] ?? '';
  const last = dates[dates.length - 1] ?? first;
  if (first === last) return DAY_MONTH.format(at(first));
  return `${at(first).getUTCDate()} – ${DAY_MONTH.format(at(last))}`;
}
/** "15 - 19 Jun 2026" for the Monday-Friday week starting on `monday`. */
export function weekLabel(monday: string): string {
  const friday = addDays(monday, 4);
  return `${DAY_MONTH.format(at(monday))} – ${DAY_MONTH_YEAR.format(at(friday))}`;
}
/** Today in the browser, as an ISO day (only used to highlight a tile). */
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** "June 2026" for `2026-06-01` (or `2026-06`). */
export function monthLabel(iso: string): string {
  return MONTH.format(at(`${iso.slice(0, 7)}-01`));
}

export type View = 'week' | 'month';

/**
 * Week | Month, then ‹ period › and "This week/month" (D-120). The page owns the state; this
 * only draws the controls and reports what was pressed.
 */
export function PeriodNav({
  view,
  start,
  current,
  onView,
  onStep,
  onCurrent,
}: {
  view: View;
  start: string | undefined;
  current: boolean;
  onView: (view: View) => void;
  onStep: (dir: -1 | 1) => void;
  onCurrent: () => void;
}) {
  const month = view === 'month';
  return (
    <div className={s.toolbar}>
      <div className={s.viewSwitch} role="group" aria-label={t('time.view')}>
        {(['week', 'month'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={cx(s.viewOption, view === v && s.viewOn)}
            aria-pressed={view === v}
            onClick={() => onView(v)}
            data-testid={`view-${v}`}
          >
            {t(v === 'week' ? 'time.viewWeek' : 'time.viewMonth')}
          </button>
        ))}
      </div>
      <div className={s.weekNav} role="group" aria-label={t(month ? 'time.month' : 'time.week')}>
        <button
          type="button"
          className={s.weekStep}
          disabled={!start}
          onClick={() => onStep(-1)}
          aria-label={t(month ? 'time.prevMonth' : 'time.prevWeek')}
          title={t(month ? 'time.prevMonth' : 'time.prevWeek')}
          data-testid="week-prev"
        >
          {'‹'}
        </button>
        <span className={s.weekLabel} data-week={start ?? ''} data-testid="week-label">
          {start ? (month ? monthLabel(start) : weekLabel(start)) : ''}
        </span>
        <button
          type="button"
          className={s.weekStep}
          disabled={!start}
          onClick={() => onStep(1)}
          aria-label={t(month ? 'time.nextMonth' : 'time.nextWeek')}
          title={t(month ? 'time.nextMonth' : 'time.nextWeek')}
          data-testid="week-next"
        >
          {'›'}
        </button>
      </div>
      <button
        type="button"
        className={s.thisWeek}
        aria-pressed={current}
        onClick={onCurrent}
        data-testid="week-this"
      >
        {t(month ? 'time.thisMonth' : 'time.thisWeek')}
      </button>
    </div>
  );
}

/** Page state for PeriodNav: the week ('' = this one) or the month (YYYY-MM). */
export function usePeriod() {
  const [view, setView] = useState<View>('week');
  const [week, setWeek] = useState('');
  const [month, setMonth] = useState('');
  const thisMonth = todayIso().slice(0, 7);
  return {
    view,
    week,
    month: view === 'month' ? month || thisMonth : '',
    current: view === 'week' ? week === '' : (month || thisMonth) === thisMonth,
    nav: (start: string | undefined) => ({
      onView: (v: View) => {
        if (v === 'month') setMonth((start ?? todayIso()).slice(0, 7));
        else setWeek('');
        setView(v);
      },
      onStep: (dir: -1 | 1) => {
        if (view === 'month') setMonth(addMonths(month || thisMonth, dir));
        else if (start) setWeek(addDays(start, 7 * dir));
      },
      onCurrent: () => (view === 'month' ? setMonth(thisMonth) : setWeek('')),
    }),
  };
}

/** A thin bar: `value` of `max`, full in the success colour. */
export function Bar({
  value,
  max,
  small = false,
}: {
  value: number;
  max: number;
  small?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : value > 0 ? 100 : 0;
  return (
    <div
      className={cx(s.bar, small && s.barSm)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={t('time.ofTarget', { total: String(value), target: String(max) })}
    >
      <span
        className={cx(s.barFill, value >= max && max > 0 && s.barDone)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
