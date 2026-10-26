// My time (D-116, FR-081/082): my week against 8 h a day and the (adjusted) weekly target, my
// entries, days off and the week note; log time on any org card I can work on. Logging here is
// the card's own time entry, so the card's Time tab shows it too. The server owns every number.
// D-154 (the user's mockup): a progress ring and day tiles, coloured stat tiles, entries grouped
// by day or by card, a weekly breakdown chart, and notes / days off behind "Add note" - all drawn
// from the same week the server sends.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Pill, Skeleton } from '../../components';
import { Icon } from '../../components/Icon';
import { fieldErrorsOf, problemBanner, type Problem } from '../../api/client';
import { t } from '../../i18n/t';
import { cx } from '../../styles/cx';
import { pageTitleClass } from '../Shell';
import { useContextData } from '../auth/useMe';
import { useSearch } from '../cards/api';
import c from '../cards/cards.module.css';
import {
  canLogTime,
  useMyTimeMutations,
  useMyWeek,
  type DayOffKind,
  type TimeDay,
  type WeekEntry,
} from './api';
import { PeriodNav, dayLabel, dayShort, rangeLabel, todayIso, usePeriod } from './parts';
import { Breakdown, Ring } from './charts';
import s from './time.module.css';

export function Status({ total, target }: { total: number; target: number }) {
  const short = Math.max(target - total, 0);
  return short > 0 ? (
    <Pill tone="warning">{t('time.shortBy', { hours: String(short) })}</Pill>
  ) : (
    <Pill tone="success">{t('time.onTarget')}</Pill>
  );
}

/** One day as a segment of the week bar: fills toward 8 h; a day off is hatched (D-116). */
function DaySegment({ day, today }: { day: TimeDay; today: boolean }) {
  const off = day.dayOff ? t(day.dayOff === 'leave' ? 'time.leave' : 'time.holiday') : '';
  const pct = day.target > 0 ? Math.min(100, Math.round((day.hours / day.target) * 100)) : 0;
  const hours = t('time.hoursShort', { n: String(day.hours) });
  return (
    <li
      className={cx(s.seg, day.dayOff && s.segOff, today && s.segToday)}
      aria-current={today ? 'date' : undefined}
      title={`${dayLabel(day.date)}: ${off || t('time.ofTarget', { total: String(day.hours), target: String(day.target) })}`}
      data-testid={`day-${day.date}`}
    >
      <span className={s.segTrack}>
        {day.dayOff ? null : (
          <span
            className={cx(s.segFill, day.hours >= day.target && s.segDone)}
            style={{ width: `${pct}%` }}
          />
        )}
      </span>
      <span className={s.segLabel}>
        <span className={s.segDay}>{dayShort(day.date)}</span>
        <span className={s.segHours}>{off || hours}</span>
      </span>
    </li>
  );
}

/** Leave / holiday for one working day - part of the week's adjustments. */
/** A month: one segment per week, filled toward that week's target (D-120). */
function MonthBar({ days, today }: { days: TimeDay[]; today: string }) {
  const weeks: TimeDay[][] = [];
  for (const d of days) {
    const last = weeks[weeks.length - 1];
    const monday = new Date(`${d.date}T00:00:00Z`).getUTCDay() === 1;
    if (!last || monday) weeks.push([d]);
    else last.push(d);
  }
  return (
    <ol
      className={s.week}
      style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
      data-testid="my-days"
      aria-label={t('time.weeks')}
    >
      {weeks.map((w, i) => {
        const hours = w.reduce((n, d) => n + d.hours, 0);
        const target = w.reduce((n, d) => n + d.target, 0);
        const pct = target > 0 ? Math.min(100, Math.round((hours / target) * 100)) : 0;
        const first = w[0]!.date;
        const isNow = w.some((d) => d.date === today);
        const total = t('time.ofTarget', {
          total: String(Math.round(hours * 100) / 100),
          target: String(target),
        });
        return (
          <li
            key={first}
            className={cx(s.seg, isNow && s.segToday)}
            title={`${t('time.weekN', { n: String(i + 1) })} (${rangeLabel(w.map((d) => d.date))}): ${total}`}
            data-testid={`week-${first}`}
          >
            <span className={s.segTrack}>
              <span
                className={cx(s.segFill, target > 0 && hours >= target && s.segDone)}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className={s.segLabel}>
              <span className={s.segDay}>
                {t('time.weekN', { n: String(i + 1) })}
                <span className={s.segRange}>{rangeLabel(w.map((d) => d.date))}</span>
              </span>
              <span className={s.segHours}>{total}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function DayOffRow({
  day,
  onDayOff,
  busy,
}: {
  day: TimeDay;
  onDayOff: (kind: DayOffKind | '') => void;
  busy: boolean;
}) {
  return (
    <label className={s.offRow}>
      <span>{dayLabel(day.date)}</span>
      <select
        className={cx(c.input, s.daySelect)}
        value={day.dayOff ?? ''}
        disabled={busy}
        onChange={(e) => onDayOff(e.target.value as DayOffKind | '')}
        aria-label={t('time.dayOffFor', { date: day.date })}
        data-testid={`day-off-${day.date}`}
      >
        <option value="">{t('time.working')}</option>
        <option value="leave">{t('time.leave')}</option>
        <option value="holiday">{t('time.holiday')}</option>
      </select>
    </label>
  );
}

/**
 * Pick an open org card (D-121): one control; it opens a list with a search box at its top.
 * Empty search = my own open cards; typing (2+ letters) searches every card I can work on.
 */
function CardPicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const me = useContextData();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<{ key: string; title: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const query: Record<string, string | boolean> = { plane: 'org', includeClosed: false };
  if (q.trim().length >= 2) query['q'] = q.trim();
  else query['assigneeId'] = me.user.id;
  const results = useSearch(query);
  // D-138: only cards you may log on (yours, or your team's as its lead; any as an admin).
  const items = (results.data?.items ?? []).filter((c) => canLogTime(c, me));
  // Opening puts the cursor in the search box; a click outside or Escape closes the list.
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const label = value && picked?.key === value ? `${picked.key} · ${picked.title}` : '';
  return (
    <div className={s.field} ref={box}>
      <span id="time-card-label" className="required-mark">
        {t('time.card')}
      </span>
      <div className={s.picker}>
        <button
          type="button"
          className={cx(c.input, s.pickerButton)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby="time-card-label"
          onClick={() => setOpen(!open)}
          data-testid="time-card"
        >
          <Icon name="search" size={18} />
          <span className={cx(s.pickerValue, !label && s.pickerPlaceholder)}>
            {label || t('time.chooseCard')}
          </span>
          <span aria-hidden="true">{'▾'}</span>
        </button>
        {open ? (
          <div className={s.pickerPanel}>
            <input
              className={cx(c.input, s.pickerSearch)}
              type="search"
              value={q}
              ref={search}
              placeholder={t('time.findCardHint')}
              aria-label={t('time.findCard')}
              onChange={(e) => setQ(e.target.value)}
              data-testid="time-card-search"
            />
            <p className={s.pickerHint}>
              {q.trim().length >= 2 ? t('time.searchResults') : t('time.myCards')}
            </p>
            <ul className={s.pickerList} role="listbox" aria-labelledby="time-card-label">
              {items.length === 0 ? (
                <li className={s.pickerEmpty}>{t('time.noCards')}</li>
              ) : (
                items.map((card) => (
                  <li key={card.key} role="option" aria-selected={card.key === value}>
                    <button
                      type="button"
                      className={cx(s.pickerOption, card.key === value && s.pickerOptionOn)}
                      onClick={() => {
                        setPicked({ key: card.key, title: card.title });
                        onChange(card.key);
                        setOpen(false);
                      }}
                      data-testid={`time-card-option-${card.key}`}
                    >
                      <span className={s.key}>{card.key}</span>
                      <span className={s.pickerTitle}>{card.title}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EntryRow({ e }: { e: WeekEntry }) {
  return (
    <li className={s.entry} data-testid="my-entry">
      <span className={s.entryMain}>
        <span className={s.key}>{e.card.key}</span>
        <Link to={`/cards/${e.card.key}`} className={s.entryTitle} title={e.card.title}>
          {e.card.title}
        </Link>
      </span>
      <span className={s.entryHours}>{t('time.hoursShort', { n: String(e.hours) })}</span>
      {e.note ? <span className={s.entryNote}>{e.note}</span> : null}
    </li>
  );
}

export function MyTime() {
  const period = usePeriod();
  const data = useMyWeek(period.week, period.month);
  const { log, note, dayOff } = useMyTimeMutations();
  const wk = data.data;
  const today = todayIso();
  const [form, setForm] = useState({ key: '', date: '', hours: '', note: '' });
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<'day' | 'card'>('day');
  const [editing, setEditing] = useState(false);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setError(null);
    setErrors({});
    setSaved(null);
    try {
      await fn();
      if (ok) setSaved(ok);
      return true;
    } catch (p) {
      setError(problemBanner(p as Problem));
      setErrors(fieldErrorsOf(p as Problem));
      return false;
    }
  }

  const days = wk?.days ?? [];
  // Default the log date to today when it is in this week, else the first working day.
  const defaultDate =
    days.find((d) => d.date === today && d.dayOff === null)?.date ??
    days.find((d) => d.dayOff === null)?.date ??
    '';
  const logDate = form.date || defaultDate;
  const byDay = new Map<string, WeekEntry[]>();
  for (const e of wk?.entries ?? []) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const daysOff = days.filter((d) => d.dayOff !== null).length;
  // D-154: entries by card - the same entries, summed per card for display.
  const byCard = new Map<
    string,
    { card: WeekEntry['card']; hours: number; entries: WeekEntry[] }
  >();
  for (const e of wk?.entries ?? []) {
    const g = byCard.get(e.card.key) ?? { card: e.card, hours: 0, entries: [] };
    g.hours = Math.round((g.hours + e.hours) * 100) / 100;
    g.entries.push(e);
    byCard.set(e.card.key, g);
  }
  const openPicker = () =>
    document.querySelector<HTMLButtonElement>('[data-testid="time-card"]')?.click();
  const remaining = wk ? Math.max(wk.target - wk.total, 0) : 0;

  return (
    <div className={c.page} data-testid="my-time">
      <div className={s.head}>
        <div className={s.headText}>
          <h1 className={pageTitleClass}>{t('time.title')}</h1>
          <p className={s.lead}>{t('time.lead')}</p>
        </div>
        <PeriodNav
          view={period.view}
          start={wk?.start}
          current={period.current}
          {...(() => {
            const nav = period.nav(wk?.start);
            const reset = () => {
              setNoteDraft(null);
              setForm({ ...form, date: '' });
            };
            return {
              onView: (v: 'week' | 'month') => (reset(), nav.onView(v)),
              onStep: (dir: -1 | 1) => (reset(), nav.onStep(dir)),
              onCurrent: () => (reset(), nav.onCurrent()),
            };
          })()}
        />
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {saved ? <Alert tone="success">{saved}</Alert> : null}
      {data.isPending || !wk ? (
        <Skeleton lines={4} label={t('card.loading')} />
      ) : (
        <>
          <section className={cx(s.panel, s.summary)} aria-label={t('time.thisWeekTotal')}>
            <div className={s.figure} data-testid="week-summary">
              <div className={s.figureTop}>
                <Ring value={wk.total} max={wk.target} />
                <span className={s.figureText}>
                  <span className={s.big}>{t('time.hoursShort', { n: String(wk.total) })}</span>
                  <span className={s.of}>
                    {t('time.ofTargetLong', { target: String(wk.target) })}
                  </span>
                  <Status total={wk.total} target={wk.target} />
                </span>
              </div>
              {wk.period === 'month' ? (
                <MonthBar days={days} today={today} />
              ) : (
                <ol className={s.week} data-testid="my-days" aria-label={t('time.days')}>
                  {days.map((d) => (
                    <DaySegment key={d.date} day={d} today={d.date === today} />
                  ))}
                </ol>
              )}
            </div>
            <ul className={s.stats}>
              <li className={cx(s.stat, s.statGreen)} data-testid="stat-remaining">
                <Icon name="cal" size={20} />
                <span className={s.statValue}>
                  {t('time.hoursShort', { n: String(remaining) })}
                </span>
                <span className={s.statLabel}>{t('time.remaining')}</span>
              </li>
              <li className={cx(s.stat, s.statBlue)} data-testid="stat-entries">
                <Icon name="list" size={20} />
                <span className={s.statValue}>{wk.entries.length}</span>
                <span className={s.statLabel}>{t('time.entryCount')}</span>
              </li>
              <li className={cx(s.stat, s.statPink)} data-testid="stat-days-off">
                <Icon name="plane" size={20} />
                <span className={s.statValue}>{daysOff}</span>
                <span className={s.statLabel}>{t('time.daysOff')}</span>
              </li>
            </ul>
          </section>

          <div className={s.work}>
            <div className={s.mainCol}>
              <section className={s.panel} aria-labelledby="time-entries">
                <div className={s.panelHead}>
                  <div>
                    <h2 id="time-entries" className={s.panelTitle}>
                      {t(wk.period === 'month' ? 'time.entriesMonth' : 'time.entries')}
                    </h2>
                    <p className={s.panelHint}>
                      {t('time.entriesFor', { range: rangeLabel(days.map((d) => d.date)) })}
                    </p>
                  </div>
                  <label className={s.groupPick}>
                    <span>{t('time.groupBy')}</span>
                    <select
                      className={c.input}
                      value={groupBy}
                      onChange={(e) => setGroupBy(e.target.value as 'day' | 'card')}
                      data-testid="entries-group"
                    >
                      <option value="day">{t('time.groupDay')}</option>
                      <option value="card">{t('time.groupCard')}</option>
                    </select>
                  </label>
                </div>
                {wk.entries.length === 0 ? (
                  <div className={s.empty} data-testid="entries-empty">
                    <span className={s.emptyIcon} aria-hidden="true">
                      <Icon name="clock" size={32} />
                    </span>
                    <p className={s.emptyTitle}>
                      {t(wk.period === 'month' ? 'time.noEntriesMonth' : 'time.noEntriesWeek')}
                    </p>
                    <p className={s.panelHint}>{t('time.noEntriesLead')}</p>
                    <Button variant="secondary" onClick={openPicker} data-testid="entries-first">
                      {t('time.logFirst')}
                    </Button>
                  </div>
                ) : groupBy === 'card' ? (
                  <ul className={s.groups} data-testid="my-entries">
                    {[...byCard.values()]
                      .sort((x, y) => y.hours - x.hours)
                      .map((g) => (
                        <li key={g.card.key}>
                          <h3 className={s.groupHead}>
                            <span className={s.groupCard}>
                              <span className={s.key}>{g.card.key}</span> {g.card.title}
                            </span>
                            <span className={s.groupTotal}>
                              {t('time.hoursShort', { n: String(g.hours) })}
                            </span>
                          </h3>
                          <ul className={s.entryList}>
                            {g.entries.map((e) => (
                              <li key={e.id} className={s.entry} data-testid="my-entry">
                                <span className={s.entryMain}>
                                  <span className={s.key}>{e.card.key}</span>
                                  <span className={s.entryTitle}>{dayLabel(e.date)}</span>
                                </span>
                                <span className={s.entryHours}>
                                  {t('time.hoursShort', { n: String(e.hours) })}
                                </span>
                                {e.note ? <span className={s.entryNote}>{e.note}</span> : null}
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <ul className={s.groups} data-testid="my-entries">
                    {days
                      .filter((d) => byDay.has(d.date))
                      .map((d) => (
                        <li key={d.date}>
                          <h3 className={s.groupHead}>
                            {dayLabel(d.date)}
                            <span className={s.groupTotal}>
                              {t('time.hoursShort', { n: String(d.hours) })}
                            </span>
                          </h3>
                          <ul className={s.entryList}>
                            {(byDay.get(d.date) ?? []).map((e) => (
                              <EntryRow key={e.id} e={e} />
                            ))}
                          </ul>
                        </li>
                      ))}
                  </ul>
                )}
              </section>

              <section className={s.panel} aria-labelledby="time-breakdown-title">
                <h2 id="time-breakdown-title" className={s.panelTitle}>
                  {t(wk.period === 'month' ? 'time.breakdownMonth' : 'time.breakdown')}
                </h2>
                <p className={s.panelHint}>
                  {t(wk.period === 'month' ? 'time.breakdownMonthLead' : 'time.breakdownLead')}
                </p>
                <Breakdown days={days} month={wk.period === 'month'} />
              </section>
            </div>

            <div className={s.side}>
              <section className={s.panel} aria-labelledby="time-log">
                <h2 id="time-log" className={s.panelTitle}>
                  {t('time.logTitle')}
                </h2>
                <form
                  className={s.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!form.key || !logDate || !form.hours) return;
                    void run(
                      () =>
                        log.mutateAsync({
                          key: form.key,
                          body: { date: logDate, hours: Number(form.hours), note: form.note },
                        }),
                      t('time.logged', { hours: form.hours, key: form.key }),
                    ).then((ok) => ok && setForm({ ...form, hours: '', note: '' }));
                  }}
                  data-testid="time-log-form"
                >
                  <CardPicker value={form.key} onChange={(key) => setForm({ ...form, key })} />
                  <div className={s.pair}>
                    <label className={s.field}>
                      {/* D-154: the control sits in an icon wrapper, so the mark is explicit. */}
                      <span className="required-mark">{t('time.date')}</span>
                      <span className={s.adorn}>
                        <Icon name="cal" size={18} />
                        <select
                          className={cx(c.input, s.adorned)}
                          value={logDate}
                          onChange={(e) => setForm({ ...form, date: e.target.value })}
                          required
                          data-testid="time-log-date"
                        >
                          {days.map((d) => (
                            <option key={d.date} value={d.date}>
                              {dayLabel(d.date)}
                            </option>
                          ))}
                        </select>
                      </span>
                    </label>
                    <label className={s.field}>
                      <span className="required-mark">{t('time.hours')}</span>
                      <span className={s.adorn}>
                        <Icon name="clock" size={18} />
                        <input
                          className={cx(c.input, s.adorned, errors['hours'] && c.invalid)}
                          type="number"
                          min={0.25}
                          max={24}
                          step={0.25}
                          required
                          inputMode="decimal"
                          placeholder="0"
                          value={form.hours}
                          onChange={(e) => setForm({ ...form, hours: e.target.value })}
                          data-testid="time-log-hours"
                        />
                      </span>
                    </label>
                  </div>
                  {errors['hours'] ? <span className={c.fieldError}>{errors['hours']}</span> : null}
                  <label className={s.field}>
                    <span>{t('time.noteOptional')}</span>
                    <span className={s.adorn}>
                      <input
                        className={cx(c.input, s.countered)}
                        maxLength={500}
                        placeholder={t('time.notePlaceholderLog')}
                        value={form.note}
                        onChange={(e) => setForm({ ...form, note: e.target.value })}
                        data-testid="time-log-note"
                      />
                      <span
                        className={s.counter}
                        aria-hidden="true"
                      >{`${form.note.length}/500`}</span>
                    </span>
                  </label>
                  <div className={s.formFoot}>
                    <Button
                      type="submit"
                      variant="primary"
                      busy={log.isPending}
                      data-testid="time-log-submit"
                    >
                      <Icon name="clock" size={18} />
                      {t('time.log')}
                    </Button>
                  </div>
                </form>
              </section>

              <section className={s.panel} aria-labelledby="time-note">
                <div className={s.panelHead}>
                  <h2 id="time-note" className={s.panelTitle}>
                    {t('time.noteTitle')}
                  </h2>
                  {wk.period !== 'month' && !editing ? (
                    <Button
                      variant="secondary"
                      onClick={() => setEditing(true)}
                      data-testid="note-add"
                    >
                      <Icon name={wk.note || daysOff > 0 ? 'gear' : 'plus'} size={16} />
                      {t(wk.note || daysOff > 0 ? 'time.editNote' : 'time.addNote')}
                    </Button>
                  ) : null}
                </div>
                {wk.period === 'month' ? (
                  <p className={s.panelHint} data-testid="month-adjust-hint">
                    {t('time.monthAdjustHint')}
                  </p>
                ) : !editing ? (
                  wk.note || daysOff > 0 ? (
                    <div className={s.noteView} data-testid="note-view">
                      {days
                        .filter((d) => d.dayOff)
                        .map((d) => (
                          <Pill key={d.date} tone="muted">
                            {`${dayLabel(d.date)} · ${t(d.dayOff === 'leave' ? 'time.leave' : 'time.holiday')}`}
                          </Pill>
                        ))}
                      {wk.note ? <p className={s.noteText}>{wk.note}</p> : null}
                    </div>
                  ) : (
                    <div className={cx(s.empty, s.emptyDashed)} data-testid="note-empty">
                      <span className={s.emptyIcon} aria-hidden="true">
                        <Icon name="book" size={24} />
                      </span>
                      <p className={s.emptyTitle}>{t('time.noNotes')}</p>
                      <p className={s.panelHint}>{t('time.noNotesLead')}</p>
                    </div>
                  )
                ) : (
                  <>
                    <p className={s.panelHint}>{t('time.noteLead')}</p>
                    <fieldset className={s.offs}>
                      <legend className={s.offsLegend}>{t('time.daysOffLegend')}</legend>
                      {days.map((d) => (
                        <DayOffRow
                          key={d.date}
                          day={d}
                          busy={dayOff.isPending}
                          onDayOff={(kind) =>
                            void run(() => dayOff.mutateAsync({ date: d.date, kind }))
                          }
                        />
                      ))}
                    </fieldset>
                    <form
                      className={s.form}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(
                          () =>
                            note.mutateAsync({
                              weekStart: wk.weekStart,
                              note: noteDraft ?? wk.note,
                            }),
                          t('time.noteSaved'),
                        ).then((ok) => {
                          if (!ok) return;
                          setNoteDraft(null);
                          setEditing(false);
                        });
                      }}
                    >
                      <label className={s.field}>
                        <span className="visually-hidden">{t('time.noteTitle')}</span>
                        <textarea
                          className={cx(c.input, c.textarea)}
                          rows={3}
                          maxLength={2000}
                          placeholder={t('time.notePlaceholder')}
                          value={noteDraft ?? wk.note}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          data-testid="week-note"
                        />
                      </label>
                      <div className={s.formFoot}>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setNoteDraft(null);
                            setEditing(false);
                          }}
                          data-testid="week-note-done"
                        >
                          {t('time.done')}
                        </Button>
                        <Button
                          type="submit"
                          variant="primary"
                          busy={note.isPending}
                          data-testid="week-note-save"
                        >
                          {t('time.saveNote')}
                        </Button>
                      </div>
                    </form>
                  </>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
