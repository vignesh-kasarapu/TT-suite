import { useEffect, useRef, useState } from 'react';
import { FileBarChart, AlertTriangle, Download } from 'lucide-react';
import {
  getLeaveTakenReport, getLopReport, getLopPending, getEncashmentReport, getCompOffReport, downloadReport,
  getEntitlementReport, getRestrictionReport, getAdjustmentReport, getCarryForwardReport,
  getArchivedLeaveTypeReport,
} from '../../api/reports';
import { getDashboard, listEmployees, getWatchableEmployees } from '../../api/employees';
import { listDepartments } from '../../api/admin';
import { useAuth } from '../../context/AuthContext';
import GlassCard from '../common/GlassCard';
import StatusBadge from '../common/StatusBadge';
import ResponsiveList from '../common/ResponsiveList';
import { formatServerDate, parseServerDate } from '../../utils/serverTime';

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

/** Entitlement, carry-forward, usage, restrictions and what is left — the same figures the
 * dashboards read, so a report can never disagree with a tile. */
const ENTITLEMENT_COLUMNS = [
  { key: 'employee', label: 'Employee', render: employeeCell },
  { key: 'leaveType', label: 'Leave type', render: (r) => (
    <div>
      {r.leave_type}
      {r.is_shared_pool && <span className="pill pill--accent ml-1">shared</span>}
    </div>
  ) },
  { key: 'granted', label: 'Granted', nowrap: true, render: (r) => <span className="num">{r.entitlement_granted}</span> },
  { key: 'carried', label: 'Carried', nowrap: true, render: (r) => <span className="num">{r.carry_forward}</span> },
  { key: 'used', label: 'Used', nowrap: true, render: (r) => <span className="num">{r.leave_used}</span> },
  { key: 'restricted', label: 'Held back', nowrap: true, render: (r) => <span className="num">{r.temporarily_restricted}</span> },
  { key: 'available', label: 'Available', nowrap: true, render: (r) => <span className="num">{r.available_balance}</span> },
];

const RESTRICTION_COLUMNS = [
  { key: 'employee', label: 'Employee', render: (r) => <span className="name">{r.employee_name}</span> },
  { key: 'leaveType', label: 'Leave type', render: (r) => r.leave_type },
  { key: 'days', label: 'Days', nowrap: true, render: (r) => <span className="num">{r.days}</span> },
  { key: 'window', label: 'Period', nowrap: true, render: (r) => <span className="num">{r.start_date} → {r.end_date}</span> },
  { key: 'state', label: 'State', render: (r) => <span className="pill pill--muted">{r.effective_state.toLowerCase()}</span> },
  { key: 'reason', label: 'Reason', render: (r) => r.reason },
];

const LEDGER_COLUMNS = [
  { key: 'employee', label: 'Employee', render: (r) => <span className="name">{r.employee_name}</span> },
  { key: 'leaveType', label: 'Leave type', render: (r) => r.leave_type },
  { key: 'entryType', label: 'Kind', render: (r) => <span className="pill pill--muted">{r.entry_type.replaceAll('_', ' ').toLowerCase()}</span> },
  { key: 'days', label: 'Days', nowrap: true, render: (r) => <span className="num">{r.days}</span> },
  { key: 'reason', label: 'Reason', render: (r) => r.reason || '—' },
  { key: 'recorded', label: 'Recorded', nowrap: true, render: (r) => formatServerDate(r.recorded_at) },
];

const ARCHIVED_TYPE_COLUMNS = [
  { key: 'type', label: 'Leave type', render: (r) => (
    <div><span className="name">{r.type_name}</span> <span className="pill pill--muted font-mono">{r.type_code}</span></div>
  ) },
  { key: 'entitlement', label: 'Was', nowrap: true, render: (r) => <span className="num">{r.annual_entitlement ?? '—'} day(s)/yr</span> },
  { key: 'archived', label: 'Archived', nowrap: true, render: (r) => formatServerDate(r.archived_at) },
  { key: 'history', label: 'History kept', nowrap: true, render: (r) => `${r.leave_requests} request(s), ${r.ledger_entries} ledger row(s)` },
];

const SIMPLE_VIEWS = {
  entitlement: { columns: ENTITLEMENT_COLUMNS, fetch: getEntitlementReport, key: (r, i) => `${r.employee_id}-${r.leave_type}-${i}`, label: 'Entitlement' },
  restrictions: { columns: RESTRICTION_COLUMNS, fetch: getRestrictionReport, key: (r) => r.restriction_id, label: 'Restrictions' },
  adjustments: { columns: LEDGER_COLUMNS, fetch: getAdjustmentReport, key: (r) => r.entry_id, label: 'Adjustments' },
  'carry-forward': { columns: LEDGER_COLUMNS, fetch: getCarryForwardReport, key: (r) => r.entry_id, label: 'Carry-forward' },
  'archived-leave-types': { columns: ARCHIVED_TYPE_COLUMNS, fetch: () => getArchivedLeaveTypeReport(), key: (r) => r.leave_type_id, label: 'Archived types' },
};

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
  return Math.max(Math.ceil((parseServerDate(raw) - Date.now()) / 3_600_000), 0);
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
const lopWhen = (r) => formatServerDate(r.source === 'CONVERTED' ? r.converted_at : r.applied_at);
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

const ENCASHMENT_STATUS = {
  REQUESTED: ['Awaiting HR', 'pill--warning'],
  POSTED: ['Encashed', 'pill--success'],
  REJECTED: ['Rejected', 'pill--danger'],
};
const COMP_OFF_STATUS = {
  PENDING_MANAGER: ['With manager', 'pill--accent'],
  PENDING_HR: ['With HR', 'pill--warning'],
  APPROVED: ['Credited', 'pill--success'],
  REJECTED: ['Rejected', 'pill--danger'],
};
const statusPill = (map) => (r) => {
  const [label, pill] = map[r.status] || [r.status, 'pill--muted'];
  return <span className={`pill ${pill}`}>{label}</span>;
};

// Days, never money: LMS records what was encashed and payroll applies its own rates.
const ENCASHMENT_COLUMNS = [
  { key: 'employee', label: 'Employee', render: employeeCell },
  { key: 'days', label: 'Days', render: (r) => (
    <div>
      <span className="num">{r.days_requested}</span> requested
      {r.days_encashed != null && <p className="muted small num">{r.days_encashed} encashed</p>}
    </div>
  ) },
  { key: 'raised', label: 'Raised', nowrap: true, render: (r) => (
    <div>
      {formatServerDate(r.requested_at)}
      {r.requested_by_name && <p className="muted small">by {r.requested_by_name}</p>}
    </div>
  ) },
  { key: 'decided', label: 'Decision', nowrap: true, render: (r) => (
    <div>
      {formatServerDate(r.decided_at)}
      {r.decided_by_name && <p className="muted small">by {r.decided_by_name}</p>}
    </div>
  ) },
  { key: 'status', label: 'Status', numeric: true, render: statusPill(ENCASHMENT_STATUS) },
];

const COMP_OFF_COLUMNS = [
  { key: 'employee', label: 'Employee', render: employeeCell },
  { key: 'work', label: 'Extra work', nowrap: true, render: (r) => (
    <div>
      <span className="num">{r.work_date}</span>
      <p className="muted small num">{r.hours_worked ?? '—'} hour(s) → {r.days} day(s)</p>
    </div>
  ) },
  { key: 'manager', label: 'Manager', nowrap: true, render: (r) => (
    <div>
      {r.manager_name || '—'}
      {r.manager_decided_at && <p className="muted small">{formatServerDate(r.manager_decided_at)}</p>}
    </div>
  ) },
  { key: 'hr', label: 'HR', nowrap: true, render: (r) => (
    <div>
      {r.hr_name || '—'}
      {r.hr_decided_at && <p className="muted small">{formatServerDate(r.hr_decided_at)}</p>}
    </div>
  ) },
  { key: 'status', label: 'Status', numeric: true, render: statusPill(COMP_OFF_STATUS) },
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
  // Rows are kept with the view they belong to. Switching view re-renders before the new
  // request is even sent, so rendering the new view's columns against the old view's rows
  // read fields that are not there — one undefined field took the whole page down.
  const [data, setData] = useState({ view: null, rows: [] });
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
      setLeaveTypes(res.data.leaveTypes || (res.data.balances || []).map(({ leaveType }) => leaveType));
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
    const simple = SIMPLE_VIEWS[view];
    const fetcher = simple ? simple.fetch(params)
      : view === 'leave-taken' ? getLeaveTakenReport(params)
        : view === 'encashment' ? getEncashmentReport(params)
          : view === 'comp-off' ? getCompOffReport(params)
            : getLopReport(params);
    fetcher
      .then((res) => {
        if (requestId === requestIdRef.current) setData({ view, rows: res.data });
      })
      .catch((err) => {
        if (requestId === requestIdRef.current) setError(err.message);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [view, filters]);

  // Only ever render rows that came from the view being shown.
  const rows = data.view === view ? data.rows : [];
  const busy = loading || data.view !== view;

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
          <button type="button" aria-pressed={view === 'encashment'} onClick={() => setView('encashment')}>Encashment</button>
          <button type="button" aria-pressed={view === 'comp-off'} onClick={() => setView('comp-off')}>Comp off</button>
          {/* Entitlement is open to everyone (the backend scopes the rows); the rest are
              HR's own views of what was adjusted, carried or archived. */}
          <button type="button" aria-pressed={view === 'entitlement'} onClick={() => setView('entitlement')}>Entitlement</button>
          <button type="button" aria-pressed={view === 'restrictions'} onClick={() => setView('restrictions')}>Restrictions</button>
          {isHrAdmin && <button type="button" aria-pressed={view === 'adjustments'} onClick={() => setView('adjustments')}>Adjustments</button>}
          {isHrAdmin && <button type="button" aria-pressed={view === 'carry-forward'} onClick={() => setView('carry-forward')}>Carry-forward</button>}
          {isHrAdmin && <button type="button" aria-pressed={view === 'archived-leave-types'} onClick={() => setView('archived-leave-types')}>Archived types</button>}
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

      {busy ? (
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
      ) : view === 'encashment' ? (
        <ResponsiveList
          columns={ENCASHMENT_COLUMNS}
          rows={rows}
          rowKey={(r) => r.encashment_id}
          renderCard={(r) => (
            <>
              <header>
                <span className="name">{r.employee_name}</span>
                {statusPill(ENCASHMENT_STATUS)(r)}
              </header>
              <div className="meta">
                <span>{r.employee_code}</span>
                <span>{r.leave_type_name}</span>
                <span className="num">{r.days_requested}d requested</span>
                <span>{formatServerDate(r.requested_at)}</span>
              </div>
            </>
          )}
        />
      ) : SIMPLE_VIEWS[view] ? (
        <ResponsiveList
          columns={SIMPLE_VIEWS[view].columns}
          rows={rows}
          rowKey={SIMPLE_VIEWS[view].key}
          renderCard={(r) => (
            <>
              <header><span className="name">{r.employee_name || r.type_name}</span></header>
              <div className="meta">
                {SIMPLE_VIEWS[view].columns.slice(1).map((c) => (
                  <span key={c.key}>{c.label}: {typeof c.render === 'function' ? c.render(r) : r[c.key]}</span>
                ))}
              </div>
            </>
          )}
        />
      ) : view === 'comp-off' ? (
        <ResponsiveList
          columns={COMP_OFF_COLUMNS}
          rows={rows}
          rowKey={(r) => r.comp_off_id}
          renderCard={(r) => (
            <>
              <header>
                <span className="name">{r.employee_name}</span>
                {statusPill(COMP_OFF_STATUS)(r)}
              </header>
              <div className="meta">
                <span>{r.employee_code}</span>
                <span className="num">{r.work_date}</span>
                <span className="num">{r.hours_worked ?? '—'}h → {r.days}d</span>
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
