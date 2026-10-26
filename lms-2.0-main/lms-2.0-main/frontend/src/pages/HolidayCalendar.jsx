import { useEffect, useState } from 'react';
import { PartyPopper, AlertTriangle } from 'lucide-react';
import { listHolidays, getOptionalHolidaySummary, selectOptionalHoliday, deselectOptionalHoliday } from '../api/holidays';
import GlassCard from '../components/common/GlassCard';
import EmptyState from '../components/common/EmptyState';
import { GhostButton, PrimaryButton } from '../components/common/GlassButton';
import Topbar from '../components/layout/Topbar';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

      <GlassCard>
        {loading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 48, borderRadius: 'var(--radius-sm)' }} />)}
          </div>
        ) : error ? (
          <EmptyState icon={AlertTriangle} title="Couldn't load the holiday calendar" description={error} />
        ) : !holidays.length ? (
          <EmptyState icon={PartyPopper} title="No holidays published yet" description="HR/Admin publishes the holiday calendar for the current and next leave year." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {holidays.map((h) => {
              const summary = summaries[h.leave_year_id];
              // The summary is a camelCase response; `holidays` from /holidays is snake_case.
              const isSelected = summary?.eligibleHolidays?.find((e) => e.holidayId === h.holiday_id)?.isSelected;
              const quotaReached = summary && !isSelected && summary.remaining <= 0;
              const busy = busyHolidayId === h.holiday_id;
              const [, month, day] = h.holiday_date.split('-');
              const weekday = new Date(`${h.holiday_date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
              return (
                <div
                  key={h.holiday_id}
                  className="flex flex-col gap-3 p-3"
                  style={{
                    borderRadius: 'var(--radius-md)',
                    // A selected optional holiday is the one state worth seeing at a glance
                    // across the whole grid, so it gets the accent edge rather than a pill.
                    border: `1px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: isSelected ? 'var(--color-tint-3)' : 'var(--color-surface)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="shrink-0 text-center px-2 py-1"
                      style={{ borderRadius: 'var(--radius-sm)', background: 'var(--color-tint-2)', minWidth: 56 }}
                    >
                      <p className="num" style={{ fontSize: 20, lineHeight: 1.1, fontWeight: 'var(--font-weight-medium)' }}>{day}</p>
                      <p className="muted small">{MONTH_ABBR[Number(month) - 1]}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="name" style={{ overflowWrap: 'anywhere' }}>{h.holiday_name}</p>
                      <p className="muted small">{weekday}, {h.holiday_date}</p>
                      <span className={`pill ${h.is_optional ? 'pill--holiday' : 'pill--muted'}`} style={{ marginTop: 4 }}>
                        {h.is_optional ? 'Optional' : 'Public holiday'}
                      </span>
                    </div>
                  </div>

                  {h.is_optional && (
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
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </>
  );
}
