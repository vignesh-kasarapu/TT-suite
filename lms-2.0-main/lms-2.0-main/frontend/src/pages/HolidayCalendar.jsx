import { useEffect, useState } from 'react';
import { PartyPopper, AlertTriangle, CalendarDays } from 'lucide-react';
import { listHolidays, getOptionalHolidaySummary, selectOptionalHoliday, deselectOptionalHoliday } from '../api/holidays';
import GlassCard from '../components/common/GlassCard';
import EmptyState from '../components/common/EmptyState';
import { GhostButton, PrimaryButton } from '../components/common/GlassButton';
import Topbar from '../components/layout/Topbar';
import HolidayCard from '../components/common/HolidayCard';

const MONTH_FMT = { month: 'long', year: 'numeric' };
const DAY = 24 * 60 * 60 * 1000;

/** "in 5 days", "tomorrow", "today" for the next-holiday strip. */
function whenFromToday(isoDate, todayIso) {
  const days = Math.round((new Date(`${isoDate}T00:00:00`) - new Date(`${todayIso}T00:00:00`)) / DAY);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** Holidays grouped by calendar month, in date order: [{ key: '2026-11', label, items }]. */
function byMonth(holidays) {
  const groups = new Map();
  for (const h of holidays) {
    const key = h.holiday_date.slice(0, 7);
    if (!groups.has(key)) {
      groups.set(key, { key, label: new Date(`${key}-01T00:00:00`).toLocaleDateString('en-US', MONTH_FMT), items: [] });
    }
    groups.get(key).items.push(h);
  }
  return [...groups.values()];
}

export default function HolidayCalendar() {
  const [holidays, setHolidays] = useState([]);
  // Keyed by leave_year_id — a holiday's optional-selection quota/usage is scoped to its own
  // leave year, and the calendar shows both the current and next leave year at once.
  const [summaries, setSummaries] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyHolidayId, setBusyHolidayId] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    return listHolidays()
      .then((res) => {
        setHolidays(res.data);
        const optionalYearIds = [...new Set(res.data.filter((h) => h.is_optional).map((h) => h.leave_year_id))];
        return Promise.all(optionalYearIds.map((id) => getOptionalHolidaySummary(id).then((r) => [id, r.data])));
      })
      .then((entries) => setSummaries(Object.fromEntries(entries)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const toggleSelection = async (holiday, isSelected) => {
    setBusyHolidayId(holiday.holiday_id);
    try {
      if (isSelected) await deselectOptionalHoliday(holiday.holiday_id);
      else await selectOptionalHoliday(holiday.holiday_id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyHolidayId(null);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = holidays.filter((h) => h.holiday_date >= today);
  const next = upcoming[0];
  const upcomingCount = upcoming.length;

  return (
    <>
      <Topbar title="Holiday Calendar" />

      {Object.entries(summaries).map(([yearId, s]) => (
        <div key={yearId} className="alert alert--info mb-4" role="status">
          <PartyPopper />
          <p>
            Optional holidays: <b>{s.taken} of {s.quota}</b> selected
            {s.remaining > 0 ? ` — ${s.remaining} remaining` : ' — quota reached'}.
          </p>
        </div>
      ))}

      {loading ? (
        <GlassCard>
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 48, borderRadius: 'var(--radius-sm)' }} />)}
          </div>
        </GlassCard>
      ) : error ? (
        <GlassCard>
          <EmptyState icon={AlertTriangle} title="Couldn't load the holiday calendar" description={error} />
        </GlassCard>
      ) : !holidays.length ? (
        <GlassCard>
          <EmptyState icon={PartyPopper} title="No holidays published yet" description="HR/Admin publishes the holiday calendar for the current and next leave year." />
        </GlassCard>
      ) : (
        <>
          {/* What is coming up, in one line, above the calendar. */}
          <div className="panel mb-5 flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="holiday-intro">
            <div className="flex items-center gap-3">
              <CalendarDays className="w-5 h-5 text-accent-text" />
              {next ? (
                <p>
                  Next holiday: <b>{next.holiday_name}</b>{' '}
                  <span className="muted">
                    ({new Date(`${next.holiday_date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })},{' '}
                    {whenFromToday(next.holiday_date, today)})
                  </span>
                </p>
              ) : (
                <p className="muted">No more holidays this leave year.</p>
              )}
            </div>
            <p className="small muted">
              {holidays.length} holiday{holidays.length === 1 ? '' : 's'} · {upcomingCount} upcoming
              {' '}· showing holidays for all regions and your own region of working
            </p>
          </div>

          <div className="flex flex-col gap-6">
            {byMonth(holidays).map((group) => (
              <section key={group.key} aria-label={group.label}>
                <h2 className="h3 mb-3">{group.label}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {group.items.map((h) => {
                    const summary = summaries[h.leave_year_id];
                    // The summary is a camelCase response; `holidays` from /holidays is snake_case.
                    const isSelected = summary?.eligibleHolidays?.find((e) => e.holidayId === h.holiday_id)?.isSelected;
                    const quotaReached = summary && !isSelected && summary.remaining <= 0;
                    const busy = busyHolidayId === h.holiday_id;
                    const isPast = h.holiday_date < today;
                    return (
                      <HolidayCard
                        key={h.holiday_id}
                        holiday={h}
                        selected={!!isSelected}
                        dimmed={isPast}
                        extraPills={(
                          <span className="pill pill--muted">{h.region_id == null ? 'All regions' : 'Your region'}</span>
                        )}
                      >
                        {h.is_optional && !isPast && (
                          isSelected ? (
                            <GhostButton className="w-full" onClick={() => toggleSelection(h, true)} disabled={busy}>
                              {busy ? 'Working…' : 'Selected — tap to remove'}
                            </GhostButton>
                          ) : (
                            <PrimaryButton
                              className="w-full"
                              onClick={() => toggleSelection(h, false)}
                              disabled={busy || quotaReached}
                            >
                              {busy ? 'Working…' : quotaReached ? 'Quota reached' : 'Select this holiday'}
                            </PrimaryButton>
                          )
                        )}
                      </HolidayCard>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
