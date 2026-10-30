import { useEffect, useRef, useState } from 'react';
import { FileBarChart, AlertTriangle, Download } from 'lucide-react';
import { getLeaveTakenReport, getLopReport, getLopPending, downloadReport } from '../../api/reports';
import { getDashboard, listEmployees, getWatchableEmployees } from '../../api/employees';
import { listDepartments } from '../../api/admin';
import { useAuth } from '../../context/AuthContext';
import GlassCard from '../common/GlassCard';
import StatusBadge from '../common/StatusBadge';
import ResponsiveList from '../common/ResponsiveList';

const STATES = [
  'PENDING_MANAGER', 'PENDING_HR', 'APPROVED', 'REJECTED', 'REJECTED_PENDING_WITHDRAWAL',
  'WITHDRAWN', 'LOP_APPLIED', 'CANCELLATION_REQUESTED', 'CANCELLED',
];

/** The report endpoints return each row flat — `employee_name`/`leave_type_name`, not the
 * nested `employee`/`LeaveType` objects Sequelize used to eager-load. */
const employeeCell = (r) => (
  <div>
    <span className="name">{r.employee_name}</span>{' '}
    <span className="pill pill--muted">{r.employee_code}</span>
  </div>
);

/** The day count belongs with the span it measures, so it sits directly under the dates
 * instead of in a column of its own two headers away. */
const datesCell = (r) => (
  <div>
    <span className="num">{r.start_date} → {r.end_date}</span>
    <p className="muted small num">{r.deducted_days} day(s)</p>
  </div>
);

const LEAVE_TAKEN_COLUMNS = [
  { key: 'employee', label: 'Employee', render: employeeCell },
  { key: 'leaveType', label: 'Leave type', render: (r) => r.leave_type_name },
  { key: 'dates', label: 'Dates', nowrap: true, render: datesCell },
  // `numeric` right-aligns the column; status is the last thing read, so it sits at the edge.
  { key: 'status', label: 'Status', numeric: true, render: (r) => <StatusBadge state={r.state} /> },
];

// LOP rows are either leave applied AS loss of pay (source APPLIED, with its state) or an
// automatic conversion of unwithdrawn leave (source CONVERTED).
const LOP_STATE = { APPROVED: ['Approved', 'pill--success'], PENDING_MANAGER: ['Pending manager', 'pill--warning'], PENDING_HR: ['Pending HR', 'pill--warning'] };
const ADVANCE_STATUS = { PENDING: ['Awaiting employee', 'pill--warning'], CONFIRMED: ['Confirmed', 'pill--danger'] };
const hoursLeft = (r) => {
  if (r.lop_status !== 'PENDING' || !r.lop_decision_deadline) return null;
  const raw = r.lop_decision_deadline;
  return Math.max(Math.ceil((new Date(/[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw}Z`) - Date.now()) / 3_600_000), 0);
};
const lopHow = (r) => (r.source === 'ADVANCE' ? (
  <span className="flex flex-col gap-0.5">
    <span className="flex items-center gap-1.5 flex-wrap">
      Beyond the balance ({r.leave_type_name})
      <span className={`pill ${(ADVANCE_STATUS[r.lop_status] || [r.lop_status, 'pill--muted'])[1]}`}>
        {(ADVANCE_STATUS[r.lop_status] || [r.lop_status])[0]}
      </span>
    </span>
    <span className="small muted">
      {r.total_days} day(s): {r.balance_days} from balance, <b>{r.deducted_days} LOP</b>
      {hoursLeft(r) !== null ? ` · ${hoursLeft(r)} h left to withdraw` : ''}
    </span>
  </span>
) : r.source === 'APPLIED' ? (
  <span className="flex items-center gap-1.5 flex-wrap">
    Applied as LOP
    <span className={`pill ${(LOP_STATE[r.state] || [r.state, 'pill--muted'])[1]}`}>{(LOP_STATE[r.state] || [r.state])[0]}</span>
  </span>
) : `Converted from ${r.prior_leave_type_name || '—'}`);
const lopWhen = (r) => new Date(r.source === 'CONVERTED' ? r.converted_at : r.applied_at).toLocaleDateString();
// Unpaid days: approved LOP leave, confirmed LOP beyond the balance, and conversions. Anything
// still awaiting a decision is not counted yet.
const isLostToPay = (r) => (r.source === 'APPLIED' ? r.state === 'APPROVED'
  : r.source === 'ADVANCE' ? r.lop_status === 'CONFIRMED' : true);

const LOP_COLUMNS = [
  { key: 'employee', label: 'Employee', render: employeeCell },
  { key: 'how', label: 'Type', render: lopHow },
  { key: 'dates', label: 'Dates', nowrap: true, render: datesCell },
  { key: 'when', label: 'Applied / converted on', nowrap: true, numeric: true, render: lopWhen },
];

const LOP_PENDING_COLUMNS = [
  { key: 'employee', label: 'Employee', render: employeeCell },
  { key: 'type', label: 'Leave type', render: (r) => r.leave_type_name || '—' },
  {
    key: 'dates',
    label: 'Dates',
    nowrap: true,
    render: (r) => (
      <div>
        <span className="num">{r.start_date} → {r.end_date}</span>
        <p className="muted small num">{r.deducted_days} day(s) at risk</p>
      </div>
    ),
  },
  {
    key: 'window',
    label: 'Withdraw by',
    nowrap: true,
    numeric: true,
    render: (r) => (
      <span className={`pill ${r.days_left_to_withdraw <= 2 ? 'pill--danger' : 'pill--warning'}`}>
        {r.days_left_to_withdraw} day(s) left
      </span>
    ),
  },
];

const emptyFilters = { from: '', to: '', leaveTypeId: '', status: '', employeeId: '', departmentId: '', managerId: '' };

// The API reads snake_case query params; these form keys are camelCase, so an unmapped filter
// is silently ignored server-side rather than rejected.
const PARAM_NAMES = {
  from: 'from_date', to: 'to_date', leaveTypeId: 'leave_type_id', status: 'state',
  employeeId: 'employee_id', departmentId: 'department_id', managerId: 'manager_id',
};

const toQuery = (filters) => Object.fromEntries(
  Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [PARAM_NAMES[k] || k, v]),
);

export default function ReportsAdmin() {
  const { hasRole } = useAuth();
  const isHrAdmin = hasRole('HR_ADMIN');
  // Mirrors the backend's scope rule (reports.py's _viewer_scope), so the page says up front
  // whose rows it is showing rather than leaving a short list looking like a bug.
  const scopeLabel = isHrAdmin
    ? 'Everyone'
    : hasRole('MANAGER') ? 'You and your team' : 'Your own records';

  const [view, setView] = useState('leave-taken');
  const [filters, setFilters] = useState(emptyFilters);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lopPending, setLopPending] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [managers, setManagers] = useState([]);
  // Mirrors ApplyLeave.jsx's previewRequestId ref pattern: switching views/filters while a
  // fetch for the OLD combination is still in flight must not let that late response render
  // through the NEW combination's field-mapping. Each fetch only applies its result if it's
  // still the current one when it resolves.
  const requestIdRef = useRef(0);

  // Leave types via the dashboard endpoint (any authenticated user) rather than
  // /admin/leave-types, which is HR/Admin-only and would 403 for a Manager viewing this page.
  useEffect(() => {
    getDashboard().then((res) => {
      setLeaveTypes((res.data.balances || []).map(({ leaveType }) => leaveType));
    }).catch(() => {});
  }, []);

  // Org-wide filters (department/employee) only make sense — and are only authorized —
  // for HR/Admin's unscoped view. A Manager's results are already restricted to their own
  // reporting hierarchy server-side.
  useEffect(() => {
    if (!isHrAdmin) return;
    listDepartments().then((res) => setDepartments(res.data)).catch(() => {});
    listEmployees().then((res) => setEmployees(res.data)).catch(() => {});
    getWatchableEmployees().then((res) => setManagers(res.data)).catch(() => {});
  }, [isHrAdmin]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const requestId = ++requestIdRef.current;
    const params = toQuery(filters);
    const fetcher = view === 'leave-taken' ? getLeaveTakenReport(params) : getLopReport(params);
    fetcher
      .then((res) => {
        if (requestId === requestIdRef.current) setRows(res.data);
      })
      .catch((err) => {
        if (requestId === requestIdRef.current) setError(err.message);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [view, filters]);

  const [exporting, setExporting] = useState(null);
  const exportRows = async (format) => {
    setExporting(format);
    try {
      await downloadReport(view, toQuery(filters), format);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(null);
    }
  };

  // Unfiltered on purpose: "what is about to become unpaid" is a standing watch-list, not
  // something you'd want silently narrowed by whatever date range is in the filter bar.
  useEffect(() => {
    if (view !== 'lop') return;
    getLopPending().then((res) => setLopPending(res.data)).catch(() => setLopPending([]));
  }, [view]);

  const sumDays = (list) => list.reduce((total, r) => total + Number(r.deducted_days || 0), 0);
  const lopTotalDays = view === 'lop' ? sumDays(rows.filter(isLostToPay)) : 0;
  const pendingTotalDays = sumDays(lopPending);

  const updateFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <h3 className="h3 flex items-center gap-2">
          <FileBarChart className="w-4 h-4 text-accent-text" /> Reports
          <span className="pill pill--muted">{scopeLabel}</span>
        </h3>
        {/* Loss of pay is every employee's own payroll business, so this view is open to
            everyone. The backend decides whose rows come back: HR/Admin everyone, a manager
            their reporting line, anyone else only their own. */}
        <div className="seg" role="group" aria-label="Report view">
          <button type="button" aria-pressed={view === 'leave-taken'} onClick={() => setView('leave-taken')}>Leave taken</button>
          <button type="button" aria-pressed={view === 'lop'} onClick={() => setView('lop')}>Loss of pay</button>
        </div>
        <div className="actions">
          <button type="button" className="btn btn--secondary btn--sm" disabled={!rows.length || !!exporting} onClick={() => exportRows('csv')}>
            <Download /> {exporting === 'csv' ? 'Exporting…' : 'CSV'}
          </button>
          <button type="button" className="btn btn--secondary btn--sm" disabled={!rows.length || !!exporting} onClick={() => exportRows('xlsx')}>
            <Download /> {exporting === 'xlsx' ? 'Exporting…' : 'Excel'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="field">
          <label htmlFor="rpt-from">From date</label>
          <input id="rpt-from" type="date" className="input" value={filters.from}
            onChange={(e) => updateFilter('from', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rpt-to">To date</label>
          <input id="rpt-to" type="date" className="input" value={filters.to}
            onChange={(e) => updateFilter('to', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rpt-type">Leave type</label>
          <select id="rpt-type" className="input" value={filters.leaveTypeId} onChange={(e) => updateFilter('leaveTypeId', e.target.value)}>
            <option value="">All leave types</option>
            {leaveTypes.map((t) => <option key={t.leave_type_id} value={t.leave_type_id}>{t.type_name}</option>)}
          </select>
        </div>
        {view === 'leave-taken' && (
          <div className="field">
            <label htmlFor="rpt-status">Status</label>
            <select id="rpt-status" className="input" value={filters.status} onChange={(e) => updateFilter('status', e.target.value)}>
              <option value="">All statuses</option>
              {STATES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
            </select>
          </div>
        )}
        {isHrAdmin && (
          <>
            <div className="field">
              <label htmlFor="rpt-employee">Employee</label>
              <select id="rpt-employee" className="input" value={filters.employeeId} onChange={(e) => updateFilter('employeeId', e.target.value)}>
                <option value="">All employees</option>
                {employees.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.full_name} ({e.employee_code})</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rpt-department">Department</label>
              <select id="rpt-department" className="input" value={filters.departmentId} onChange={(e) => updateFilter('departmentId', e.target.value)}>
                <option value="">All departments</option>
                {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.department_name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rpt-manager">Manager</label>
              <select id="rpt-manager" className="input" value={filters.managerId} onChange={(e) => updateFilter('managerId', e.target.value)}>
                <option value="">All managers</option>
                {managers.map((m) => <option key={m.employee_id} value={m.employee_id}>{m.full_name}</option>)}
              </select>
            </div>
            <div className="field justify-end flex">
              <button type="button" className="btn btn--secondary" onClick={() => setFilters(emptyFilters)}>
                Clear filters
              </button>
            </div>
          </>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 48 }} />)}</div>
      ) : error ? (
        <div className="alert alert--danger">
          <AlertTriangle /> <p>{error}</p>
        </div>
      ) : !rows.length && view !== 'lop' ? (
        <p className="small muted">No records for this filter.</p>
      ) : view === 'leave-taken' ? (
        <ResponsiveList
          columns={LEAVE_TAKEN_COLUMNS}
          rows={rows}
          rowKey={(r) => r.request_id}
          renderCard={(r) => (
            <>
              <header>
                <span className="name">{r.employee_name}</span>
                <StatusBadge state={r.state} />
              </header>
              <div className="meta">
                <span>{r.employee_code}</span>
                <span>{r.leave_type_name}</span>
                <span>{r.start_date} → {r.end_date}</span>
                <span className="num">{r.deducted_days}d</span>
              </div>
            </>
          )}
        />
      ) : (
        <>
          {/* Converted vs still-at-risk, side by side: the table below is what already
              became unpaid, the strip here is what will on the next sweep if nobody acts. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div className="tile"><div><b className="num">{rows.length}</b><span>LOP request(s), applied or converted</span></div></div>
            <div className="tile"><div><b className="num">{lopTotalDays.toFixed(1)}</b><span>LOP day(s) to deduct from salary</span></div></div>
            <div className="tile"><div><b className="num">{pendingTotalDays.toFixed(1)}</b><span>day(s) still at risk</span></div></div>
          </div>

          {lopPending.length > 0 && (
            <div className="mb-5">
              <h4 className="text-sm font-medium mb-2">
                Not converted yet — rejected advance leave still inside its withdrawal window
              </h4>
              <ResponsiveList
                columns={LOP_PENDING_COLUMNS}
                rows={lopPending}
                rowKey={(r) => r.request_id}
                renderCard={(r) => (
                  <>
                    <header>
                      <span className="name">{r.employee_name}</span>
                      <span className={`pill ${r.days_left_to_withdraw <= 2 ? 'pill--danger' : 'pill--warning'}`}>
                        {r.days_left_to_withdraw} day(s) left
                      </span>
                    </header>
                    <div className="meta">
                      <span>{r.leave_type_name}</span>
                      <span>{r.start_date} → {r.end_date}</span>
                      <span className="num">{r.deducted_days}d</span>
                    </div>
                  </>
                )}
              />
            </div>
          )}

          <h4 className="text-sm font-medium mb-2">Loss of pay: beyond the balance, applied as LOP, and converted</h4>
        <ResponsiveList
          columns={LOP_COLUMNS}
          rows={rows}
          empty={<p className="small muted">No loss of pay for this filter: nothing applied as LOP or converted.</p>}
          rowKey={(r) => `${r.source}-${r.request_id}-${r.lop_record_id ?? ''}`}
          renderCard={(r) => (
            <>
              <header>
                <span className="name">{r.employee_name}</span>
                <span className="muted small">{r.source === 'CONVERTED' ? 'Converted' : 'Applied'} {lopWhen(r)}</span>
              </header>
              <div className="meta">
                <span>{r.employee_code}</span>
                <span>{lopHow(r)}</span>
                <span>{r.start_date} → {r.end_date}</span>
                <span className="num">{r.deducted_days}d</span>
              </div>
            </>
          )}
        />
        </>
      )}
    </GlassCard>
  );
}
