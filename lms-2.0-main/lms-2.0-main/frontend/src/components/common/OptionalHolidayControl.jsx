import { useState } from 'react';
import { PartyPopper, X } from 'lucide-react';
import { getOptionalHolidaySummaryFor } from '../../api/holidays';
import { GhostButton } from './GlassButton';

/** Read-only view of which optional holidays a team member has chosen.
 *
 * Deliberately has no assign/remove action. An optional holiday is a personal choice —
 * which festivals someone observes — so the employee picks their own from the Holiday
 * calendar. A manager needs to know who is off and when, not to decide it for them.
 * The server still scopes this to the manager's own reporting hierarchy. */
export default function OptionalHolidayControl({ employeeId, employeeName }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !summary) {
      getOptionalHolidaySummaryFor(employeeId)
        .then((res) => setSummary(res.data))
        .catch((err) => setError(err.message));
    }
  };

  if (!open) {
    return (
      <GhostButton onClick={toggle} className="!px-2.5 !py-1.5 text-xs">
        <PartyPopper className="w-3.5 h-3.5" /> Optional holidays
      </GhostButton>
    );
  }

  // This endpoint is one of the hand-built camelCase responses, so each holiday arrives as
  // holidayId/holidayName/holidayDate, not the snake_case shape /holidays returns.
  const taken = (summary?.eligibleHolidays || []).filter((h) => h.isSelected);

  return (
    <div className="w-full p-3 rounded-md space-y-2 small" style={{ background: 'var(--color-tint-2)' }}>
      <div className="flex items-center justify-between">
        <p className="muted">Optional holidays taken by {employeeName}</p>
        <button type="button" onClick={() => setOpen(false)} className="btn btn--ghost btn--sm !min-h-0 !px-1" aria-label="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {error ? (
        <p className="error-msg">{error}</p>
      ) : !summary ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <p className="muted">{summary.taken} of {summary.quota} chosen.</p>
          {!taken.length ? (
            <p className="muted">None chosen yet — the employee selects their own from the holiday calendar.</p>
          ) : (
            <div className="space-y-1.5">
              {taken.map((h) => (
                <div key={h.holidayId} className="flex items-center justify-between gap-2 rounded-sm px-2.5 py-1.5" style={{ background: 'var(--color-surface)' }}>
                  <p className="truncate">{h.holidayName}</p>
                  <span className="pill pill--holiday shrink-0">{h.holidayDate}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
