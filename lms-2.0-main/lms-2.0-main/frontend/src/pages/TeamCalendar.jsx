import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, AlertTriangle, Clock, Users, PartyPopper } from 'lucide-react';
import { getPeerCalendar, getTeamCalendar } from '../api/employees';
import { listHolidays } from '../api/holidays';
import { useAuth } from '../context/AuthContext';
import GlassCard from '../components/common/GlassCard';
import Modal from '../components/common/Modal';
import { GhostButton, SecondaryButton } from '../components/common/GlassButton';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import Topbar from '../components/layout/Topbar';
import { colourFor, layOutWeek, monthGrid, overflowPerDay, ymd } from '../utils/calendarLayout';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_LANES = 3;
const LANE_HEIGHT = 22;

export default function TeamCalendar() {
  const { hasRole } = useAuth();
  const isManagerView = hasRole('MANAGER', 'HR_ADMIN');
  const [entries, setEntries] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selected, setSelected] = useState(null);
  const [expandedWeek, setExpandedWeek] = useState(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const weeks = useMemo(() => monthGrid(year, month), [year, month]);
  const today = ymd(new Date());

  // Fetch the visible grid, not a fixed window. The endpoint defaults to today..today+30,
  // so the old single fetch meant paging to any other month showed an empty calendar.
  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = { startDate: weeks[0][0].ymd, endDate: weeks[5][6].ymd };
    const fetcher = isManagerView ? getTeamCalendar(params) : getPeerCalendar(params);
    fetcher
      .then((res) => setEntries(res.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [isManagerView, weeks]);

  // Holidays matter on a leave calendar: without them a gap in the bars looks like
  // everyone chose the same random day off. Failure here just hides them.
  useEffect(() => {
    listHolidays().then((res) => setHolidays(res.data)).catch(() => setHolidays([]));
  }, []);

  const holidayByDate = useMemo(
    () => new Map(holidays.map((h) => [h.holiday_date, h])),
    [holidays],
  );

  const goMonth = (delta) => { setCurrentDate(new Date(year, month + delta, 1)); setExpandedWeek(null); };
  const goToday = () => { setCurrentDate(new Date()); setExpandedWeek(null); };

  const typesPresent = [...new Map(
    entries.filter((e) => e.LeaveType).map((e) => [e.LeaveType.type_code, e.LeaveType.type_name]),
  ).entries()];

  // A one-line answer to "how exposed am I this month", above the grid rather than
  // left for the reader to count off the bars.
  const inMonth = entries.filter((e) => e.start_date <= weeks[5][6].ymd && e.end_date >= weeks[0][0].ymd);
  const peopleAway = new Set(inMonth.map((e) => e.employee_id)).size;
  const busiest = useMemo(() => {
    let best = null;
    for (const week of weeks) {
      for (const d of week) {
        if (!d.inMonth) continue;
        const count = entries.filter((e) => e.start_date <= d.ymd && e.end_date >= d.ymd).length;
        if (count > 1 && (!best || count > best.count)) best = { ymd: d.ymd, day: d.day, count };
      }
    }
    return best;
  }, [entries, weeks]);

  return (
    <>
      <Topbar title={isManagerView ? 'Team Calendar' : 'Peer Leave Calendar'} />

      <GlassCard className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <span className="ico" style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'var(--color-tint-3)', display: 'grid', placeItems: 'center', color: 'var(--color-accent-text)' }}>
            <CalendarDays />
          </span>
          <div>
            <h2 className="h2">{MONTH_NAMES[month]} {year}</h2>
            <p className="muted small">
              {isManagerView
                ? 'Everyone reporting to you, at any depth. Click a bar for the detail.'
                : 'Peers at your level. Dates and status only.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-center">
          <GhostButton className="btn--sm !px-2" onClick={() => goMonth(-1)} aria-label="Previous month"><ChevronLeft /></GhostButton>
          <SecondaryButton className="btn--sm" onClick={goToday}>Today</SecondaryButton>
          <GhostButton className="btn--sm !px-2" onClick={() => goMonth(1)} aria-label="Next month"><ChevronRight /></GhostButton>
        </div>
      </GlassCard>

      <GlassCard>
        {error ? (
          <EmptyState icon={AlertTriangle} title="Could not load the calendar" description={error} />
        ) : (
          <>
            <div className="flex items-center gap-4 flex-wrap mb-3 pb-3 border-b border-border small">
              <span className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-accent-text" />
                <strong>{peopleAway}</strong> {peopleAway === 1 ? 'person' : 'people'} away in {MONTH_NAMES[month]}
              </span>
              {busiest && (
                <span className="muted">
                  Busiest day: {MONTH_NAMES[month]} {busiest.day} with {busiest.count} away
                </span>
              )}
            </div>

            <div className="grid grid-cols-7 gap-px mb-px">
              {WEEKDAYS.map((wd, i) => (
                <div
                  key={wd}
                  className="small text-center py-1.5"
                  style={{ color: i === 0 || i === 6 ? 'var(--color-text-muted)' : undefined }}
                >
                  {wd}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-px" style={{ opacity: loading ? 0.5 : 1 }}>
              {weeks.map((week, weekIndex) => {
                const segments = layOutWeek(week, entries);
                const isExpanded = expandedWeek === weekIndex;
                const laneCap = isExpanded ? Infinity : MAX_LANES;
                const visible = segments.filter((s) => s.lane < laneCap);
                const overflow = overflowPerDay(segments, laneCap);
                const laneCount = Math.max(visible.reduce((m, s) => Math.max(m, s.lane + 1), 0), 1);

                return (
                  <div
                    key={week[0].ymd}
                    className="grid grid-cols-7 gap-px"
                    style={{ gridTemplateRows: `auto auto repeat(${laneCount}, ${LANE_HEIGHT}px) auto` }}
                  >
                    {/* Day backgrounds span every row, so the bars sit on top of one cell.
                        Weekends and holidays are tinted: a gap in the bars should read as
                        "nobody works that day", not as a coincidence. */}
                    {week.map((d, i) => {
                      const isWeekend = i === 0 || i === 6;
                      const holiday = holidayByDate.get(d.ymd);
                      let background = 'var(--color-surface)';
                      if (d.ymd === today) background = 'var(--color-tint-2)';
                      else if (holiday) background = 'var(--color-tint-3)';
                      else if (isWeekend) background = 'color-mix(in srgb, var(--color-text) 4%, var(--color-surface))';
                      return (
                        <div
                          key={`bg-${d.ymd}`}
                          style={{
                            gridColumn: i + 1,
                            gridRow: '1 / -1',
                            minHeight: 96,
                            background,
                            opacity: d.inMonth ? 1 : 0.45,
                            border: d.ymd === today ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        />
                      );
                    })}

                    {week.map((d, i) => (
                      <div key={`num-${d.ymd}`} className="px-1.5 pt-1.5" style={{ gridColumn: i + 1, gridRow: 1 }}>
                        <span
                          className="num small"
                          style={{
                            fontWeight: d.ymd === today ? 'var(--font-weight-display)' : undefined,
                            color: d.ymd === today ? 'var(--color-accent-text)' : (d.inMonth ? undefined : 'var(--color-text-muted)'),
                          }}
                        >
                          {d.day}
                        </span>
                      </div>
                    ))}

                    {/* Holiday name on its own row above the bars, so it never competes
                        with them for a lane. */}
                    {week.map((d, i) => {
                      const holiday = holidayByDate.get(d.ymd);
                      if (!holiday) return null;
                      return (
                        <div
                          key={`hol-${d.ymd}`}
                          className="truncate px-1.5"
                          title={`${holiday.holiday_name}${holiday.is_optional ? ' (optional)' : ''}`}
                          style={{ gridColumn: i + 1, gridRow: 2, fontSize: 10, color: 'var(--color-accent-text)' }}
                        >
                          {holiday.holiday_name}
                        </div>
                      );
                    })}

                    {visible.map((s) => {
                      const colour = colourFor(s.entry.LeaveType?.type_code);
                      const leftRadius = s.continuesLeft ? 0 : 4;
                      const rightRadius = s.continuesRight ? 0 : 4;
                      const pending = s.entry.state !== 'APPROVED';
                      return (
                        <button
                          key={`${s.entry.request_id}-${week[0].ymd}`}
                          type="button"
                          onClick={() => setSelected(s.entry)}
                          title={`${s.entry.employee_name}, ${s.entry.start_date} to ${s.entry.end_date}`}
                          className="text-left truncate"
                          style={{
                            gridColumn: `${s.startIndex + 1} / span ${s.span}`,
                            gridRow: s.lane + 3,
                            margin: '0 3px',
                            padding: '1px 6px',
                            fontSize: 11,
                            lineHeight: '18px',
                            cursor: 'pointer',
                            color: 'var(--color-text)',
                            background: `color-mix(in srgb, ${colour} 20%, var(--color-surface))`,
                            borderLeft: s.continuesLeft ? 'none' : `3px solid ${colour}`,
                            // Not-yet-approved leave is dashed, so a manager can tell at a
                            // glance what is confirmed and what is still their decision.
                            border: pending ? `1px dashed ${colour}` : undefined,
                            borderLeftWidth: s.continuesLeft ? 0 : 3,
                            borderLeftStyle: 'solid',
                            borderLeftColor: colour,
                            // Square off whichever edge the bar is cut on, so a run across
                            // weeks reads as one block rather than as separate pills.
                            borderRadius: `${leftRadius}px ${rightRadius}px ${rightRadius}px ${leftRadius}px`,
                          }}
                        >
                          {s.continuesLeft ? '◂ ' : ''}
                          {s.entry.employee_name}
                          {s.entry.is_half_day ? ' (half day)' : ''}
                          {s.continuesRight ? ' ▸' : ''}
                        </button>
                      );
                    })}

                    {!isExpanded && overflow.some(Boolean) && week.map((d, i) => (
                      overflow[i] ? (
                        <button
                          key={`more-${d.ymd}`}
                          type="button"
                          onClick={() => setExpandedWeek(weekIndex)}
                          className="muted text-left px-1.5"
                          style={{ gridColumn: i + 1, gridRow: laneCount + 3, fontSize: 10, cursor: 'pointer' }}
                        >
                          +{overflow[i]} more
                        </button>
                      ) : null
                    ))}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-4 flex-wrap mt-4 pt-3 border-t border-border">
              {isManagerView && typesPresent.map(([code, name]) => (
                <span key={code} className="flex items-center gap-1.5 muted small">
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: colourFor(code) }} />
                  {name}
                </span>
              ))}
              <span className="flex items-center gap-1.5 muted small">
                <span style={{ width: 14, height: 10, borderRadius: 2, border: '1px dashed var(--color-text-muted)' }} />
                Not yet approved
              </span>
              <span className="flex items-center gap-1.5 muted small">
                <PartyPopper className="w-3.5 h-3.5" /> Public holiday
              </span>
            </div>

            {!loading && !entries.length && (
              <p className="muted small text-center py-6">Nobody is on leave in {MONTH_NAMES[month]}.</p>
            )}
          </>
        )}
      </GlassCard>

      {selected && (
        <Modal open onClose={() => setSelected(null)} title={selected.employee_name} maxWidth="max-w-md">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="pill pill--muted">{selected.employee?.designation || 'Team member'}</span>
              <StatusBadge state={selected.state} />
            </div>

            <div className="grid2">
              <div>
                <p className="muted small">Leave type</p>
                {/* The peer calendar deliberately omits the type (BR-41), so there is
                    nothing to show here for an employee looking at their peers. */}
                <p className="font-medium">{selected.LeaveType?.type_name || 'Not shown'}</p>
              </div>
              <div>
                <p className="muted small">Working days</p>
                <p className="font-medium num">
                  {selected.deducted_days ?? '-'}
                  {selected.is_half_day ? ` (${selected.half_day_portion === 'FIRST' ? '1st half' : '2nd half'})` : ''}
                </p>
              </div>
            </div>

            <div>
              <p className="muted small flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Dates</p>
              <p className="font-medium num">{selected.start_date} to {selected.end_date}</p>
            </div>

            {selected.reason && (
              <div>
                <p className="muted small">Reason</p>
                <p className="small">{selected.reason}</p>
              </div>
            )}

            <SecondaryButton onClick={() => setSelected(null)} className="w-full">Close</SecondaryButton>
          </div>
        </Modal>
      )}
    </>
  );
}
