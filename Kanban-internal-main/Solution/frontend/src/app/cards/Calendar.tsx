// Calendar tab (D-150): the board's own cards - same scope and filters, from the same request -
// laid out on their ETA dates, one month at a time. A month grid from 640 px up; on a phone the
// days that have cards, as a list. Cards without an ETA are counted under the month. Display
// only: which cards and which dates come from the server.
import { useState } from 'react';
import { Link } from 'react-router';
import { MQ, useMediaQuery } from '../../components/useMediaQuery';
import { Icon } from '../../components/Icon';
import { t } from '../../i18n/t';
import { cx } from '../../styles/cx';
import { formatDate } from '../../styles/format';
import { PriorityPill } from './Board';
import { projectStyle } from './projectColor';
import type { Card } from './api';
import s from './cards.module.css';

const SHOWN_PER_DAY = 3;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

function todayIso(): string {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
}

export function BoardCalendar({
  cards,
  cardHref,
}: {
  cards: Card[];
  cardHref: (key: string) => string;
}) {
  const today = todayIso();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const tabletUp = useMediaQuery(MQ.tabletUp);
  const byDay = new Map<string, Card[]>();
  for (const c of cards) if (c.eta) byDay.set(c.eta, [...(byDay.get(c.eta) ?? []), c]);
  const noEta = cards.filter((c) => !c.eta).length;

  const first = new Date(Date.UTC(month.y, month.m, 1));
  const days = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // weeks start on Monday
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => iso(month.y, month.m, i + 1)),
  ];
  while (cells.length % 7) cells.push(null);
  const title = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(first);
  const step = (n: number) =>
    setMonth(({ y, m }) => ({ y: y + Math.floor((m + n) / 12), m: (((m + n) % 12) + 12) % 12 }));
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, 1 + i)), // 1 Jan 2024 was a Monday
    ),
  );

  const cardLink = (c: Card) => (
    <li key={c.id} className={s.calCard} style={projectStyle(c.projectId)}>
      <Link
        to={cardHref(c.key)}
        className={s.calCardLink}
        title={`${c.key} · ${c.title}`}
        data-testid={`calendar-card-${c.key}`}
      >
        {c.title}
      </Link>
      <PriorityPill priority={c.priority} />
    </li>
  );

  const monthDays = cells.filter((d): d is string => d !== null && byDay.has(d));
  return (
    <section className={s.calendar} data-testid="calendar" aria-labelledby="calendar-title">
      <div className={s.calHead}>
        <button
          type="button"
          className={s.calNav}
          onClick={() => step(-1)}
          aria-label={t('calendar.prev')}
          title={t('calendar.prev')}
          data-testid="calendar-prev"
        >
          <span className={s.flip}>
            <Icon name="chev" size={18} />
          </span>
        </button>
        <h2 id="calendar-title" className={s.calTitle} data-testid="calendar-month">
          {title}
        </h2>
        <button
          type="button"
          className={s.calNav}
          onClick={() => step(1)}
          aria-label={t('calendar.next')}
          title={t('calendar.next')}
          data-testid="calendar-next"
        >
          <Icon name="chev" size={18} />
        </button>
        <button
          type="button"
          className={s.calToday}
          onClick={() =>
            setMonth({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })
          }
        >
          {t('calendar.today')}
        </button>
        <span className={s.calNoEta} data-testid="calendar-no-eta">
          {t('calendar.noEta', { n: noEta })}
        </span>
      </div>
      {tabletUp ? (
        <div className={s.calGrid} role="grid" aria-labelledby="calendar-title">
          <div className={s.calRow} role="row">
            {weekdays.map((w) => (
              <span key={w} className={s.calWeekday} role="columnheader">
                {w}
              </span>
            ))}
          </div>
          {Array.from({ length: cells.length / 7 }, (_, w) => (
            <div key={w} className={s.calRow} role="row">
              {cells.slice(w * 7, w * 7 + 7).map((day, i) => {
                const list = day ? (byDay.get(day) ?? []) : [];
                return (
                  <div
                    key={day ?? `blank-${w}-${i}`}
                    role="gridcell"
                    className={cx(s.calDay, !day && s.calBlank, day === today && s.calTodayCell)}
                    aria-label={day ? formatDate(day) : undefined}
                    data-testid={day ? `calendar-day-${day}` : undefined}
                  >
                    {day ? <span className={s.calDate}>{Number(day.slice(8))}</span> : null}
                    {list.length > 0 ? (
                      <ul className={s.calCards}>{list.slice(0, SHOWN_PER_DAY).map(cardLink)}</ul>
                    ) : null}
                    {list.length > SHOWN_PER_DAY ? (
                      <span className={s.calMore}>
                        {t('calendar.more', { n: list.length - SHOWN_PER_DAY })}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : monthDays.length === 0 ? (
        <p className={s.hint}>{t('calendar.emptyMonth')}</p>
      ) : (
        <ol className={s.calAgenda}>
          {monthDays.map((day) => (
            <li key={day} data-testid={`calendar-day-${day}`}>
              <h3 className={cx(s.calAgendaDay, day === today && s.calAgendaToday)}>
                {formatDate(day)}
              </h3>
              <ul className={s.calCards}>{(byDay.get(day) ?? []).map(cardLink)}</ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
