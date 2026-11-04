import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import {
  getEmployeeBalances, previewOpeningBalances, applyOpeningBalances, listEntitlementPools, listLeaveTypes,
} from '../../api/admin';
import { listEmployees } from '../../api/employees';
import { listDepartments } from '../../api/admin';
import GlassCard from '../common/GlassCard';
import EmptyState from '../common/EmptyState';
import ConfirmDialog from '../common/ConfirmDialog';
import { PrimaryButton } from '../common/GlassButton';
import { useToast } from '../../context/ToastContext';

/** Moving existing employees onto a new policy.
 *
 *  Nothing here happens by itself: HR picks the people, sees what each of them holds today,
 *  and only then posts the opening balance. The ledger keeps every older row — the change is
 *  a compensating entry beside them, never an overwrite. */
export default function OpeningBalanceAdmin() {
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [types, setTypes] = useState([]);
  const [pools, setPools] = useState([]);
  const [scope, setScope] = useState({ kind: 'employee', employeeId: '', departmentId: '' });
  const [target, setTarget] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [current, setCurrent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // Applying writes one ledger entry per employee, so the dry run is restated and confirmed
  // before anything is posted.
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  useEffect(() => {
    listEmployees().then((res) => setEmployees(res.data)).catch(() => {});
    listDepartments().then((res) => setDepartments(res.data)).catch(() => {});
    listLeaveTypes(false).then((res) => setTypes(res.data.filter((t) => t.is_balance_affecting && !t.pool))).catch(() => {});
    listEntitlementPools().then((res) => setPools(res.data)).catch(() => {});
  }, []);

  // What this person holds today, per target — the figures HR compares against.
  useEffect(() => {
    if (scope.kind !== 'employee' || !scope.employeeId) { setCurrent(null); return; }
    getEmployeeBalances(scope.employeeId).then((res) => setCurrent(res.data)).catch(() => setCurrent(null));
  }, [scope.kind, scope.employeeId]);

  const payload = () => {
    const [kind, id] = target.split(':');
    return {
      leaveTypeId: kind === 'type' ? Number(id) : null,
      poolId: kind === 'pool' ? Number(id) : null,
      openingBalance: Number(openingBalance),
      reason,
      employeeIds: scope.kind === 'employee' && scope.employeeId ? [Number(scope.employeeId)] : null,
      departmentId: scope.kind === 'department' && scope.departmentId ? Number(scope.departmentId) : null,
    };
  };

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await previewOpeningBalances(payload());
      setPreview(res.data);
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await applyOpeningBalances(payload());
      const message = `${res.data.applied_to} employee(s) now open on `
        + `${res.data.employees[0]?.proposed_opening_balance} day(s) of ${res.data.target_name}.`;
      setNotice(message);
      toast.success(message);
      setConfirming(false);
      setPreview(null);
      if (scope.employeeId) getEmployeeBalances(scope.employeeId).then((r) => setCurrent(r.data)).catch(() => {});
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <GlassCard className="lg:col-span-2">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
          <ClipboardList className="w-4 h-4 text-accent-text" />
          <h3 className="h3">Opening balance</h3>
        </div>
        <div className="space-y-4">
          <div className="field">
            <label>Apply to</label>
            <select className="input" value={scope.kind} onChange={(e) => setScope({ kind: e.target.value, employeeId: '', departmentId: '' })}>
              <option value="employee">One employee</option>
              <option value="department">A department</option>
              <option value="all">Every active employee</option>
            </select>
          </div>
          {scope.kind === 'employee' && (
            <div className="field">
              <label>Employee</label>
              <select className="input" value={scope.employeeId} onChange={(e) => setScope((s) => ({ ...s, employeeId: e.target.value }))}>
                <option value="">Select…</option>
                {employees.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.full_name} ({e.employee_code})</option>)}
              </select>
            </div>
          )}
          {scope.kind === 'department' && (
            <div className="field">
              <label>Department</label>
              <select className="input" value={scope.departmentId} onChange={(e) => setScope((s) => ({ ...s, departmentId: e.target.value }))}>
                <option value="">Select…</option>
                {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.department_name}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label>Leave type or shared entitlement</label>
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Select…</option>
              {pools.map((p) => <option key={`pool-${p.pool_id}`} value={`pool:${p.pool_id}`}>{p.pool_name} (shared)</option>)}
              {types.map((t) => <option key={`type-${t.leave_type_id}`} value={`type:${t.leave_type_id}`}>{t.type_name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Opening balance (days)</label>
            <input type="number" step="0.5" className="input" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
            <p className="hint">What each selected person should hold from now on. The difference is posted as one entry.</p>
          </div>
          <div className="field">
            <label>Reason</label>
            <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error && <p className="error-msg">{error}</p>}
          {notice && <p className="small">{notice}</p>}
          <button type="button" className="btn btn--secondary w-full" onClick={runPreview} disabled={busy || !target || openingBalance === ''}>
            {busy ? 'Working…' : 'Preview the change'}
          </button>
        </div>
      </GlassCard>

      <GlassCard className="lg:col-span-3">
        <div className="flex items-center justify-between gap-2 mb-4 pb-3 border-b border-border">
          <h3 className="h3">{preview ? 'Dry run' : 'What this person holds today'}</h3>
          {preview && <span className="pill pill--accent">{preview.employees_changed} would change</span>}
        </div>

        {preview ? (
          <div className="space-y-4">
            <div className="divide-y divide-border">
              {preview.employees.map((row) => (
                <div key={row.employee_id} className="py-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{row.employee_name}</p>
                    <p className="small muted">
                      holds {row.current_balance} · used {row.used} · would open on {row.proposed_opening_balance}
                    </p>
                  </div>
                  <span className={`pill ${row.difference === 0 ? 'pill--muted' : row.difference > 0 ? 'pill--success' : 'pill--danger'}`}>
                    {row.difference > 0 ? '+' : ''}{row.difference}
                  </span>
                </div>
              ))}
            </div>
            <PrimaryButton
              onClick={() => setConfirming(true)}
              disabled={busy || !reason.trim() || preview.employees_changed === 0}
              className="w-full"
            >
              {`Apply to ${preview.employees_changed} employee(s)`}
            </PrimaryButton>
            {!reason.trim() && <p className="hint">A reason is required before this can be applied.</p>}
          </div>
        ) : current ? (
          <div className="divide-y divide-border">
            {current.balances.map((b) => (
              <div key={b.target_key} className="py-2 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{b.target_name}</p>
                  <p className="small muted">
                    granted {b.entitlement} · carried {b.carry_forward} · used {b.used} · held back {b.restricted}
                  </p>
                </div>
                <div className="text-right">
                  <p className="num">{b.available}</p>
                  <p className="small muted">available · policy {b.policy_entitlement}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={ClipboardList} title="Nothing selected" description="Pick an employee to see what they hold, or preview a change." />
        )}
      </GlassCard>

      <ConfirmDialog
        open={confirming && !!preview}
        title="Post these opening balances?"
        description="One ledger entry per employee, written beside their history — nothing already on the ledger is changed or removed."
        lines={preview ? [
          ['Leave type', preview.target_name],
          ['Leave year', preview.leave_year],
          ['Employees affected', `${preview.employees_changed} of ${preview.employees.length}`],
          ['Each opens on', `${Number(openingBalance)} day(s)`],
        ] : []}
        warning={
          preview && preview.employees.some((r) => r.difference < 0)
            ? 'Some of these balances go down. The days are taken back by a compensating entry, not deleted.'
            : null
        }
        confirmLabel={busy ? 'Applying…' : 'Post opening balances'}
        onConfirm={apply}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
