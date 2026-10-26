import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import EmployeeAdmin from '../components/admin/EmployeeAdmin';
import LeaveTypeAdmin from '../components/admin/LeaveTypeAdmin';
import HolidayAdmin from '../components/admin/HolidayAdmin';
import OrgConfigAdmin from '../components/admin/OrgConfigAdmin';
import AuditLogAdmin from '../components/admin/AuditLogAdmin';
import SelfApprovalAdmin from '../components/admin/SelfApprovalAdmin';
import WorkingPatternAdmin from '../components/admin/WorkingPatternAdmin';
import NotificationTemplateAdmin from '../components/admin/NotificationTemplateAdmin';
import CapacityAdmin from '../components/admin/CapacityAdmin';
import BalanceExtrasAdmin from '../components/admin/BalanceExtrasAdmin';
import BalanceAdjustmentAdmin from '../components/admin/BalanceAdjustmentAdmin';
import LedgerAdmin from '../components/admin/LedgerAdmin';
import { getDashboard } from '../api/employees';

export default function Administration() {
  const [leaveYearId, setLeaveYearId] = useState(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const activeSection = searchParams.get('section') || 'employees';

  useEffect(() => {
    getDashboard().then((res) => setLeaveYearId(res.data.leaveYear?.leave_year_id));
  }, []);

  const sections = {
    employees: { label: 'Employees', content: <EmployeeAdmin /> },
    'leave-types': { label: 'Leave types & policy', content: <LeaveTypeAdmin /> },
    holidays: { label: 'Holiday calendar', content: <HolidayAdmin leaveYearId={leaveYearId} /> },
    'org-config': { label: 'Settings', content: <OrgConfigAdmin /> },
    'self-approval': { label: 'Self-approval', content: <SelfApprovalAdmin /> },
    'working-patterns': { label: 'Working patterns', content: <WorkingPatternAdmin /> },
    templates: { label: 'Notification templates', content: <NotificationTemplateAdmin /> },
    capacity: { label: 'Blackout & capacity', content: <CapacityAdmin /> },
    'balance-extras': { label: 'Encashment & comp-off', content: <BalanceExtrasAdmin leaveYearId={leaveYearId} /> },
    'balance-adjustment': { label: 'Balance adjustment', content: <BalanceAdjustmentAdmin /> },
    audit: { label: 'Audit log', content: <AuditLogAdmin /> },
    ledger: { label: 'Ledger', content: <LedgerAdmin /> },
  };

  const active = sections[activeSection] || sections.employees;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="small muted">Administration</p>
          <h1 className="h2">{active.label}</h1>
        </div>
        <span className="hidden pill pill--accent sm:inline-flex">HR admin workspace</span>
      </div>

      {/* Mobile-only section switcher: the sidebar's admin submenu (desktop-only)
          is the only other way to change sections, so this chip bar is what makes
          every section reachable without reopening the mobile nav each time. */}
      <div className="tabs md:hidden overflow-x-auto" role="tablist">
        {Object.entries(sections).map(([key, section]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeSection === key}
            onClick={() => navigate(`/administration?section=${key}`)}
          >
            {section.label}
          </button>
        ))}
      </div>

      <main className="min-w-0">
        {active.content}
      </main>
    </div>
  );
}
