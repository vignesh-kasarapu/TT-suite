const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * One holiday as a card: date badge, name, weekday + date, Optional / Public holiday pill.
 * The same card everywhere a holiday is listed (Holiday Calendar, dashboard, Admin > Holidays).
 * `extraPills` (e.g. the region on the admin list), `children` (buttons below) and `action`
 * (e.g. a delete icon, top right) are optional. `selected` gives the accent edge; `dimmed`
 * fades a passed holiday.
 */
export default function HolidayCard({ holiday, extraPills = null, action = null, selected = false, dimmed = false, children = null }) {
  const [, month, day] = holiday.holiday_date.split('-');
  const weekday = new Date(`${holiday.holiday_date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
  return (
    <div
      className="flex flex-col gap-3 p-3"
      data-testid={`holiday-card-${holiday.holiday_id}`}
      style={{
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
        background: selected ? 'var(--color-tint-3)' : 'var(--color-surface)',
        opacity: dimmed ? 0.55 : 1,
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
        <div className="min-w-0 flex-1">
          <p className="name" style={{ overflowWrap: 'anywhere' }}>{holiday.holiday_name}</p>
          <p className="muted small">{weekday}, {holiday.holiday_date}</p>
          <div className="flex flex-wrap gap-1.5" style={{ marginTop: 4 }}>
            <span className={`pill ${holiday.is_optional ? 'pill--holiday' : 'pill--muted'}`}>
              {holiday.is_optional ? 'Optional' : 'Public holiday'}
            </span>
            {extraPills}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}
