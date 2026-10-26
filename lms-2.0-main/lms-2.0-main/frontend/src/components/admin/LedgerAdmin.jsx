import { useEffect, useState } from 'react';
import { BookOpenText, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { getAllLedgerEntries } from '../../api/ledger';
import { listEmployees } from '../../api/employees';
import { listLeaveTypes } from '../../api/admin';
import GlassCard from '../common/GlassCard';
import EmptyState from '../common/EmptyState';
import ResponsiveList from '../common/ResponsiveList';
import { GhostButton } from '../common/GlassButton';

const ENTRY_TYPES = [
  'OPENING_PRO_RATA_CREDIT', 'PERIODIC_ACCRUAL_CREDIT', 'CARRY_FORWARD_CREDIT',
  'CARRY_FORWARD_LAPSE_DEBIT', 'LEAVE_DEDUCTION_DEBIT', 'CANCELLATION_RESTORATION_CREDIT',
  'MANUAL_ADJUSTMENT',
];

const COLUMNS = [
  { key: 'date', label: 'Date', nowrap: true, render: (e) => new Date(e.created_at).toLocaleDateString() },
  // The API returns these flat — there is no nested Employee/LeaveType object.
  {
    key: 'employee',
    label: 'Employee',
    nowrap: true,
    render: (e) => (
      <div>
        <span className="name">{e.employee_name}</span>
        <p className="muted small">{e.employee_code}</p>
      </div>
    ),
  },
  { key: 'leaveType', label: 'Leave type', nowrap: true, render: (e) => e.leave_type_name },
  { key: 'entryType', label: 'Transaction type', render: (e) => e.entry_type.replaceAll('_', ' ') },
  {
    key: 'quantity',
    label: 'Quantity',
    numeric: true,
    render: (e) => (
      <span className={`num ${parseFloat(e.quantity) < 0 ? 'text-danger-text' : 'text-success'}`}>
        {parseFloat(e.quantity) > 0 ? '+' : ''}{e.quantity}
      </span>
    ),
  },
  {
    key: 'reason',
    label: 'Why',
    render: (e) => (
      <div className="min-w-0">
        <p>{e.reason || describeSource(e.source_reference)}</p>
        <p className="muted small">{e.is_system_actor ? 'Posted by the system' : `Posted by ${e.actor_name || 'unknown'}`}</p>
      </div>
    ),
  },
];

/** `source_reference` is a machine key like "leave_request:32" or "onboarding:11". Shown raw
 * it means nothing to an HR user, so it is turned into a sentence. */
function describeSource(ref) {
  if (!ref) return '—';
  const [kind, id] = String(ref).split(':');
  const labels = {
    leave_request: 'Leave request',
    onboarding: 'Opening balance on joining',
    accrual: 'Scheduled accrual',
    carry_forward: 'Carry-forward',
    encashment: 'Encashment',
    comp_off: 'Compensatory off',
  };
  const label = labels[kind];
  if (!label) return ref;
  return id && kind === 'leave_request' ? `${label} #${id}` : label;
}

const emptyFilters = { employeeId: '', leaveTypeId: '', entryType: '', dateFrom: '', dateTo: '' };

export default function LedgerAdmin() {
  const [employees, setEmployees] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [result, setResult] = useState({ total: 0, page: 1, page_size: 50, entries: [] });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);

  useEffect(() => {
    listEmployees().then((res) => setEmployees(res.data)).catch((err) => setError(err.message));
    listLeaveTypes().then((res) => setLeaveTypes(res.data)).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = { ...filters, page };
    Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
    getAllLedgerEntries(params)
      .then((res) => setResult(res.data))
      .catch((err) => { setError(err.message); setResult({ total: 0, page: 1, page_size: 50, entries: [] }); })
      .finally(() => setLoading(false));
  }, [filters, page]);

  const updateFilter = (key, value) => {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value }));
  };

  const totalPages = Math.max(Math.ceil(result.total / (result.page_size || 50)), 1);

  return (
    <GlassCard>
      <h3 className="h3 mb-1 flex items-center gap-2">
        <BookOpenText className="w-4 h-4 text-accent-text" /> Leave ledger
      </h3>
      <p className="small muted mb-4">Every balance-affecting transaction across every employee, with filters.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-4">
        <select className="input" value={filters.employeeId} onChange={(e) => updateFilter('employeeId', e.target.value)}>
          <option value="">All employees</option>
          {employees.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.full_name}</option>)}
        </select>
        <select className="input" value={filters.leaveTypeId} onChange={(e) => updateFilter('leaveTypeId', e.target.value)}>
          <option value="">All leave types</option>
          {leaveTypes.map((t) => <option key={t.leave_type_id} value={t.leave_type_id}>{t.type_name}</option>)}
        </select>
        <select className="input" value={filters.entryType} onChange={(e) => updateFilter('entryType', e.target.value)}>
          <option value="">All transaction types</option>
          {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
        </select>
        <input type="date" className="input" value={filters.dateFrom}
          onChange={(e) => updateFilter('dateFrom', e.target.value)} placeholder="From" />
        <input type="date" className="input" value={filters.dateTo}
          onChange={(e) => updateFilter('dateTo', e.target.value)} placeholder="To" />
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="skel" style={{ height: 44 }} />)}</div>
      ) : error ? (
        <EmptyState icon={AlertTriangle} title="Couldn't load the ledger" description={error} />
      ) : !result.entries?.length ? (
        <p className="small muted text-center py-8">No ledger entries match these filters.</p>
      ) : (
        <>
          <ResponsiveList
            columns={COLUMNS}
            rows={result.entries}
            rowKey={(e) => e.entry_id}
            renderCard={(e) => (
              <>
                <header>
                  <span className="name">{e.employee_name}</span>
                  <span className={`num ${parseFloat(e.quantity) < 0 ? 'text-danger-text' : 'text-success'}`}>
                    {parseFloat(e.quantity) > 0 ? '+' : ''}{e.quantity}
                  </span>
                </header>
                <div className="meta">
                  <span>{new Date(e.created_at).toLocaleDateString()}</span>
                  <span>{e.leave_type_name}</span>
                  <span>{e.entry_type.replaceAll('_', ' ')}</span>
                </div>
                <p className="muted small">
                  {e.reason || describeSource(e.source_reference)}
                  {' · '}{e.is_system_actor ? 'system' : e.actor_name || 'unknown'}
                </p>
              </>
            )}
          />

          <div className="flex items-center justify-between mt-3 small muted">
            <span>{result.total} total entries — page {result.page} of {totalPages}</span>
            <div className="flex items-center gap-2">
              <GhostButton type="button" onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1} className="btn--sm">
                <ChevronLeft className="w-3.5 h-3.5" />
              </GhostButton>
              <GhostButton type="button" onClick={() => setPage((p) => Math.min(p + 1, totalPages))} disabled={page >= totalPages} className="btn--sm">
                <ChevronRight className="w-3.5 h-3.5" />
              </GhostButton>
            </div>
          </div>
        </>
      )}
    </GlassCard>
  );
}
