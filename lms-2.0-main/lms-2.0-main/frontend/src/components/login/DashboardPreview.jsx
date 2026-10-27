import { asset } from '../../api/paths';
import { LayoutDashboard, CalendarCheck2, FilePlus2, CalendarDays, CheckSquare, FileBarChart } from 'lucide-react';

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard', active: true },
  { icon: CalendarCheck2, label: 'My Leaves' },
  { icon: FilePlus2, label: 'Apply Leave' },
  { icon: CalendarDays, label: 'Calendar' },
  { icon: CheckSquare, label: 'Approvals' },
  { icon: FileBarChart, label: 'Reports' },
];

const CAL_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// April 2025 starts on a Tuesday; leading blanks pad the first week.
const CAL_CELLS = [null, null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
const CAL_MARKS = { 15: 'rejected', 16: 'selected', 23: 'rejected', 29: 'approved' };

function PreviewSidebar() {
  return (
    <div className="w-[150px] shrink-0 flex flex-col gap-1 pr-3 py-4 pl-4 border-r border-border">
      <div className="flex items-center gap-2 mb-4 px-1">
        <img src={asset('brand/tektalis.svg')} alt="" style={{ height: 10 }} />
      </div>
      {NAV_ITEMS.map(({ icon: Icon, label, active }) => (
        <div
          key={label}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10.5px] ${
            active ? 'bg-tint-1 text-accent-text' : 'muted'
          }`}
        >
          <Icon size={12} className="shrink-0" />
          <span className="truncate">{label}</span>
        </div>
      ))}
    </div>
  );
}

function PreviewHeader() {
  return (
    <div className="flex items-center justify-between mb-3.5">
      <div>
        <p className="text-[13px] font-semibold leading-tight">Welcome back!</p>
        <p className="text-[10.5px] muted">Here's your leave overview</p>
      </div>
      <div className="w-7 h-7 rounded-full shrink-0 bg-accent" />
    </div>
  );
}

function PreviewStats() {
  const stats = [
    { value: '18', label: 'Available Leave', className: '' },
    { value: '2', label: 'Pending Requests', className: 'text-warning' },
    { value: '12', label: 'Used This Year', className: '' },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 mb-3">
      {stats.map((s) => (
        <div key={s.label} className="rounded-lg px-2.5 py-2 text-center bg-surface border border-border">
          <p className={`text-[15px] font-bold leading-none ${s.className}`}>{s.value}</p>
          <p className="text-[9px] muted mt-1.5 leading-tight">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

function PreviewCalendar() {
  return (
    <div className="rounded-lg p-2.5 bg-surface border border-border">
      <p className="text-[10px] font-semibold mb-1.5">April 2025</p>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {CAL_DAYS.map((d, i) => (
          <span key={`${d}-${i}`} className="text-[7px] muted">{d}</span>
        ))}
        {CAL_CELLS.map((day, i) => {
          const mark = day ? CAL_MARKS[day] : null;
          return (
            <span
              key={i}
              className={`text-[8px] leading-[16px] rounded-full ${
                mark === 'selected'
                  ? 'bg-accent text-accent-contrast font-semibold'
                  : mark === 'rejected'
                  ? 'bg-danger-bg text-danger-text'
                  : mark === 'approved'
                  ? 'bg-success-bg text-success'
                  : 'muted'
              }`}
            >
              {day || ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function UpcomingLeave() {
  const items = [
    { className: 'bg-accent', label: 'Annual Leave', date: 'Apr 16 – Apr 18' },
    { className: 'bg-danger', label: 'Sick Leave', date: 'Apr 15' },
    { className: 'bg-tint-3', label: 'Personal Leave', date: 'May 5 – May 6' },
  ];
  return (
    <div className="rounded-lg p-2.5 bg-surface border border-border">
      <p className="text-[10px] font-semibold mb-1.5">Upcoming Leave</p>
      <div className="flex flex-col gap-1.5">
        {items.map((it) => (
          <div key={it.label} className="flex items-start gap-1.5 text-[9px]">
            <span className={`w-1.5 h-1.5 rounded-full mt-0.5 shrink-0 ${it.className}`} />
            <span>
              {it.label}
              <br />
              <span className="muted">{it.date}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FloatingCallout() {
  return (
    <div className="absolute -bottom-7 -right-8 w-[190px] px-4 py-3.5 rounded-2xl z-10 bg-surface border border-border shadow-card">
      <div className="flex items-center gap-2">
        <CalendarCheck2 size={16} className="shrink-0 text-accent-text" />
        <p className="text-[12px] font-medium leading-snug">
          Work-life balance starts with you.
        </p>
      </div>
    </div>
  );
}

export default function DashboardPreview() {
  return (
    <div className="relative hidden lg:block w-full max-w-[700px] mt-8">
      <div className="grid grid-cols-[150px,1fr] rounded-[22px] overflow-hidden bg-surface border border-border shadow-popover">
        <PreviewSidebar />
        <div className="px-4 py-4 min-w-0">
          <PreviewHeader />
          <PreviewStats />
          <div className="grid grid-cols-[1.3fr,1fr] gap-2">
            <PreviewCalendar />
            <UpcomingLeave />
          </div>
        </div>
      </div>

      <FloatingCallout />
    </div>
  );
}
