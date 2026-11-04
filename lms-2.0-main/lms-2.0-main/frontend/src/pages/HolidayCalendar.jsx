import { useEffect, useMemo, useState } from 'react';
import { PartyPopper, AlertTriangle, CalendarDays, CalendarCheck, Sparkles } from 'lucide-react';
import { listHolidays, getOptionalHolidaySummary, selectOptionalHoliday, deselectOptionalHoliday } from '../api/holidays';
import GlassCard from '../components/common/GlassCard';
import EmptyState from '../components/common/EmptyState';
import { GhostButton, PrimaryButton } from '../components/common/GlassButton';
import ConfirmDialog from '../components/common/ConfirmDialog';
import Topbar from '../components/layout/Topbar';
import HolidayCard from '../components/common/HolidayCard';
import { useToast } from '../context/ToastContext';

/** "2 of 3 chosen, 1 left" — what the quota looks like after the answer being asked for. */
function optionalQuotaLine(summary, removing) {
  if (!summary) return '—';
  const taken = Math.max(summary.taken + (removing ? -1 : 1), 0);
  const remaining = Math.max(summary.quota - taken, 0);
  return `${taken} of ${summary.quota} chosen, ${remaining} left`;
}

const MONTH_FMT = { month: 'long', year: 'numeric' };
const DAY = 24 * 60 * 60 * 1000;

/** Whole days between two YYYY-MM-DD dates, negative once the first one has passed. */
function daysUntil(isoDate, todayIso) {
  return Math.round((new Date(`${isoDate}T00:00:00`) - new Date(`${todayIso}T00:00:00`)) / DAY);
}

/** "in 5 days", "tomorrow", "today" for the next-holiday strip. */
function whenFromToday(isoDate, todayIso) {
  const days = daysUntil(isoDate, todayIso);
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

/** Tabs across the top, same pattern as My Requests. `match` takes (holiday, today). */
const FILTERS = [
  { key: 'ALL', label: 'All', match: null },
  { key: 'UPCOMING', label: 'Upcoming', match: (h, today) => h.holiday_date >= today },
  { key: 'OPTIONAL', label: 'Optional', match: (h) => h.is_optional },
  { key: 'PAST', label: 'Past', match: (h, today) => h.holiday_date < today },
];

export default function HolidayCalendar() {
  const [holidays, setHolidays] = useState([]);
  // Keyed by leave_year_id — a holiday's optional-selection quota/usage is scoped to its own
  // leave year, and the calendar shows both the current and next leave year at once.
  const [summaries, setSummaries] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyHolidayId, setBusyHolidayId] = useState(null);
  // The holiday waiting for a yes/no, with what the answer would do.
  const [pending, setPending] = useState(null);
  const toast = useToast();
  const [filter, setFilter] = useState('ALL');

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

  // Choosing an optional holiday spends one of a limited quota, and giving one back frees
  // it: both are worth a moment's thought, so both are confirmed rather than done on a tap.
  const confirmSelection = async () => {
    if (!pending) return;
    const { holiday, isSelected } = pending;
    setBusyHolidayId(holiday.holiday_id);
    try {
      if (isSelected) await deselectOptionalHoliday(holiday.holiday_id);
      else await selectOptionalHoliday(holiday.holiday_id);
      await load();
      toast.success(
        isSelected
          ? `${holiday.holiday_name} removed. The day is back in your optional quota.`
          : `${holiday.holiday_name} is yours — you are off that day.`,
      );
      setPending(null);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusyHolidayId(null);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = holidays.filter((h) => h.holiday_date >= today);
  const next = upcoming[0];

  // Counts come off the same predicates the tabs filter by, so a chip can never promise a
  // number the list below it does not show.
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, f.match ? holidays.filter((h) => f.match(h, today)).length : holidays.length])),
    [holidays, today],
  );
  const activeFilter = FILTERS.find((f) => f.key === filter) || FILTERS[0];
  const visible = activeFilter.match ? holidays.filter((h) => activeFilter.match(h, today)) : holidays;
  // A published holiday is either a public one or an optional one, so these two add up to
  // the total — the figure HR is asked for most often.
  const publicCount = holidays.filter((h) => !h.is_optional).length;

  // Both leave years' optional quotas added up — the per-year breakdown stays in the
  // notice below, which is where a year actually needs naming.
  const optionalTotals = Object.values(summaries).reduce(
    (acc, s) => ({ taken: acc.taken + s.taken, quota: acc.quota + s.quota }),
    { taken: 0, quota: 0 },
  );

  return (
    <>
      <Topbar title="Holiday Calendar" />

      <div className="page-hero" data-testid="holiday-intro">
        <div className="flex items-center gap-4 min-w-0">
          <span className="ico"><PartyPopper /></span>
          <div className="min-w-0">
            <h1>Holidays this year</h1>
            <p>
              {next
                ? <>Next up: <b>{next.holiday_name}</b> ({whenFromToday(next.holiday_date, today)}).</>
                : 'No more holidays this leave year.'}
              {' '}Showing all regions and your own region of working.
            </p>
          </div>
        </div>
        {optionalTotals.quota > 0 && (
          <span className="pill pill--accent">
            <Sparkles className="w-3.5 h-3.5" /> {optionalTotals.taken} of {optionalTotals.quota} optional selected
          </span>
        )}
      </div>

      <div className="tiles">
        <div className="tile">
          <span className="ico"><CalendarDays /></span>
          <div>
            <b className="num">{holidays.length}</b>
            <span>Holiday(s) published</span>
          </div>
        </div>
        <div className="tile">
          <span className="ico"><CalendarCheck /></span>
          <div>
            <b className="num">{publicCount}</b>
            <span>Public holiday(s)</span>
          </div>
        </div>
        <div className="tile">
          <span className="ico"><Sparkles /></span>
          <div>
            <b className="num">{counts.OPTIONAL}</b>
            <span>Optional holiday(s)</span>
          </div>
        </div>
      </div>

      {Object.entries(summaries).map(([yearId, s]) => (
        <div key={yearId} className="alert alert--info" role="status">
          <PartyPopper />
          <p>
            Optional holidays: <b>{s.taken} of {s.quota}</b> selected
            {s.remaining > 0 ? ` — ${s.remaining} remaining` : ' — quota reached'}.
          </p>
        </div>
      ))}

      {/* Empty tabs are still shown: "Past (0)" is information, and a tab list that changes
          shape through the year is harder to aim at than one that doesn't. */}
      {!loading && !error && holidays.length > 0 && (
        <div className="page-filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`pill ${filter === f.key ? 'pill--accent' : 'pill--muted'}`}
            >
              {f.label} ({counts[f.key]})
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="skel" style={{ height: 110, borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : error ? (
        <GlassCard>
          <EmptyState icon={AlertTriangle} title="Couldn't load the holiday calendar" description={error} />
        </GlassCard>
      ) : !holidays.length ? (
        <GlassCard>
          <EmptyState icon={PartyPopper} title="No holidays published yet" description="HR/Admin publishes the holiday calendar for the current and next leave year." />
        </GlassCard>
      ) : !visible.length ? (
        <GlassCard>
          <EmptyState icon={PartyPopper} title="Nothing in this view" description="No holiday matches this filter. Pick another tab to see the rest." />
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-6">
          {byMonth(visible).map((group) => (
            <section key={group.key} aria-label={group.label}>
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <h2 className="h3">{group.label}</h2>
                <span className="muted small">{group.items.length} holiday{group.items.length === 1 ? '' : 's'}</span>
              </div>
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
                          // The state is a state, not an instruction: the pill says it is
                          // taken, the button says what you can do about it.
                          <div className="flex items-center justify-between gap-2">
                            <span className="pill pill--success">
                              <CalendarCheck className="w-3.5 h-3.5" /> Selected
                            </span>
                            <GhostButton
                              className="btn--sm"
                              onClick={() => setPending({ holiday: h, isSelected: true })}
                              disabled={busy}
                            >
                              Remove
                            </GhostButton>
                          </div>
                        ) : (
                          <PrimaryButton
                            className="w-full"
                            onClick={() => setPending({ holiday: h, isSelected: false })}
                            disabled={busy || quotaReached}
                          >
                            {quotaReached ? 'Quota reached' : 'Select this holiday'}
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
      )}

      <ConfirmDialog
        open={!!pending}
        title={pending?.isSelected ? `Remove ${pending.holiday.holiday_name}?` : `Take ${pending?.holiday.holiday_name}?`}
        description={
          pending?.isSelected
            ? 'The day goes back to being a working day, and the choice returns to your optional quota.'
            : 'You will be off that day, and it uses one of your optional holidays.'
        }
        lines={pending ? [
          ['Date', pending.holiday.holiday_date],
          ['Optional holidays', optionalQuotaLine(summaries[pending.holiday.leave_year_id], pending.isSelected)],
        ] : []}
        confirmLabel={pending?.isSelected ? 'Remove it' : 'Take this day'}
        tone={pending?.isSelected ? 'danger' : 'primary'}
        onConfirm={confirmSelection}
        onClose={() => setPending(null)}
      />
    </>
  );
}
