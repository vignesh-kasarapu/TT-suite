import { useEffect, useRef, useState } from 'react';
import { Scale, AlertTriangle } from 'lucide-react';
import { getEmployeeLedger, adjustBalance } from '../../api/ledger';
import { listEmployees, getDashboard } from '../../api/employees';
import { listLeaveTypesShort } from '../../api/admin';
import GlassCard from '../common/GlassCard';
import ConfirmDialog from '../common/ConfirmDialog';
import { PrimaryButton } from '../common/GlassButton';
import { useToast } from '../../context/ToastContext';
import { formatServerDate } from '../../utils/serverTime';

export default function BalanceAdjustmentAdmin() {
  const [employees, setEmployees] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [ledger, setLedger] = useState([]);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // The leave year an adjustment is posted against. It used to be read off the ledger rows,
  // which never carried the field, so every adjustment went out with leaveYearId undefined
  // against a required backend field.
  const [leaveYearId, setLeaveYearId] = useState(null);
  // A ledger entry is permanent (BR-07 never deletes one), so the figures are restated in a
  // dialog before it is posted.
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();
  const ledgerRequestId = useRef(0);

  useEffect(() => {
    listEmployees().then((res) => setEmployees(res.data)).catch((err) => setLoadError(err.message));
    listLeaveTypesShort().then((res) => setLeaveTypes(res.data)).catch((err) => setLoadError(err.message));
    getDashboard().then((res) => setLeaveYearId(res.data.leaveYear?.leave_year_id)).catch(() => {});
  }, []);

  useEffect(() => {
    if (employeeId && leaveTypeId) {
      // Guard against a stale, slower response overwriting the ledger for a
      // selection the user has since moved away from.
      const requestId = ++ledgerRequestId.current;
      getEmployeeLedger(employeeId, { leaveTypeId })
        .then((res) => { if (requestId === ledgerRequestId.current) { setLedger(res.data); setLoadError(null); } })
        .catch((err) => { if (requestId === ledgerRequestId.current) setLoadError(err.message); });
    } else {
      ledgerRequestId.current += 1;
      setLedger([]);
    }
  }, [employeeId, leaveTypeId]);

  const currentBalance = ledger.length ? ledger[ledger.length - 1].running_balance : 0;
  const employeeName = employees.find((e) => String(e.employee_id) === String(employeeId))?.full_name;
  const leaveTypeName = leaveTypes.find((t) => String(t.leave_type_id) === String(leaveTypeId))?.type_name;
  const projectedBalance = currentBalance + (parseFloat(quantity) || 0);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await adjustBalance({
        employeeId, leaveTypeId, quantity: parseFloat(quantity), reason,
        leaveYearId: leaveYearId ?? ledger[0]?.leave_year_id,
      });
      toast.success(
        `${parseFloat(quantity) > 0 ? '+' : ''}${parseFloat(quantity)} day(s) posted. `
        + `${employeeName || 'The employee'} now holds ${projectedBalance.toFixed(1)}.`,
      );
      setQuantity('');
      setReason('');
      setConfirming(false);
      const requestId = ++ledgerRequestId.current;
      getEmployeeLedger(employeeId, { leaveTypeId })
        .then((res) => { if (requestId === ledgerRequestId.current) setLedger(res.data); })
        .catch((err) => { if (requestId === ledgerRequestId.current) setLoadError(err.message); });
    } catch (err) {
      setError(err.message); // e.g. missing-reason refusal (LMS-054/BR-15)
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <GlassCard className="lg:col-span-2">
        <h3 className="h3 mb-1 flex items-center gap-2">
          <Scale className="w-4 h-4 text-accent-text" /> Balance adjustment
        </h3>
        <p className="small muted mb-4">Every adjustment requires a reason and is written to the ledger — never silent.</p>

        {loadError && (
          <div className="alert alert--danger mb-3">
            <AlertTriangle /> <p>{loadError}</p>
          </div>
        )}

        <div className="space-y-3">
          <select className="input" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setConfirming(false); }}>
            <option value="">Employee…</option>
            {employees.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.full_name}</option>)}
          </select>
          <select className="input" value={leaveTypeId} onChange={(e) => { setLeaveTypeId(e.target.value); setConfirming(false); }}>
            <option value="">Leave type…</option>
            {leaveTypes.map((t) => <option key={t.leave_type_id} value={t.leave_type_id}>{t.type_name}</option>)}
          </select>

          {employeeId && leaveTypeId && (
            <>
              <div className="calc">
                <span className="muted small">Current balance</span>
                <b className="num">{currentBalance.toFixed(1)}</b>
              </div>

              <input type="number" step="0.5" className="input" placeholder="Signed quantity (e.g. -2 or 5)" value={quantity}
                onChange={(e) => { setQuantity(e.target.value); setConfirming(false); }} />
              <textarea className="input min-h-[70px] resize-none" placeholder="Reason (mandatory)" value={reason}
                onChange={(e) => { setReason(e.target.value); setConfirming(false); }} />

              {quantity && (
                <div className="calc">
                  <span className="muted small">Projected balance after this adjustment</span>
                  <b className={`num ${projectedBalance < 0 ? 'text-warning' : ''}`}>{projectedBalance.toFixed(1)}</b>
                </div>
              )}

              {error && (
                <div className="alert alert--danger">
                  <AlertTriangle /> <p>{error}</p>
                </div>
              )}

              <PrimaryButton
                onClick={() => setConfirming(true)}
                disabled={!quantity || !reason.trim() || saving}
                className="w-full"
              >
                Review adjustment
              </PrimaryButton>
            </>
          )}
        </div>
      </GlassCard>

      <ConfirmDialog
        open={confirming}
        title="Post this adjustment?"
        description="It is written to the ledger as a new entry and cannot be edited or removed; a correction is another adjustment."
        lines={[
          ['Employee', employeeName || employeeId],
          ['Leave type', leaveTypeName || leaveTypeId],
          ['Balance now', currentBalance.toFixed(1)],
          ['Adjustment', `${parseFloat(quantity || 0) > 0 ? '+' : ''}${parseFloat(quantity || 0)} day(s)`],
          ['Balance after', projectedBalance.toFixed(1)],
        ]}
        warning={projectedBalance < 0 ? 'This leaves the balance negative.' : null}
        confirmLabel={saving ? 'Posting…' : 'Post adjustment'}
        onConfirm={submit}
        onClose={() => setConfirming(false)}
      />

      <GlassCard className="lg:col-span-3">
        <h3 className="h3 mb-4">Full ledger</h3>
        {!employeeId || !leaveTypeId ? (
          <p className="small muted">Select an employee and leave type to see their ledger.</p>
        ) : !ledger.length ? (
          <p className="small muted">No ledger entries for this employee/type/year.</p>
        ) : (
          <div className="max-h-[480px] overflow-y-auto">
            {ledger.map((entry) => (
              <div key={entry.entry_id} className="py-2.5 flex items-center justify-between border-t border-border first:border-t-0">
                <div>
                  <p className="small">{entry.entry_type.replaceAll('_', ' ').toLowerCase()}</p>
                  <p className="muted small">
                    {entry.leave_type_name} · {formatServerDate(entry.created_at)} · {entry.source_reference}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`num ${parseFloat(entry.quantity) < 0 ? 'text-danger-text' : 'text-success'}`}>
                    {parseFloat(entry.quantity) > 0 ? '+' : ''}{entry.quantity}
                  </p>
                  <p className="muted small">bal: {entry.running_balance.toFixed(1)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
