import { useEffect, useRef, useState } from 'react';
import { Scale, AlertTriangle } from 'lucide-react';
import { getEmployeeLedger, adjustBalance } from '../../api/ledger';
import { listEmployees } from '../../api/employees';
import { listLeaveTypesShort } from '../../api/admin';
import GlassCard from '../common/GlassCard';
import { PrimaryButton } from '../common/GlassButton';

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
  const [confirming, setConfirming] = useState(false);
  const ledgerRequestId = useRef(0);

  useEffect(() => {
    listEmployees().then((res) => setEmployees(res.data)).catch((err) => setLoadError(err.message));
    listLeaveTypesShort().then((res) => setLeaveTypes(res.data)).catch((err) => setLoadError(err.message));
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
  const projectedBalance = currentBalance + (parseFloat(quantity) || 0);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await adjustBalance({ employeeId, leaveTypeId, leaveYearId: ledger[0]?.leave_year_id, quantity: parseFloat(quantity), reason });
      setQuantity('');
      setReason('');
      setConfirming(false);
      const requestId = ++ledgerRequestId.current;
      getEmployeeLedger(employeeId, { leaveTypeId })
        .then((res) => { if (requestId === ledgerRequestId.current) setLedger(res.data); })
        .catch((err) => { if (requestId === ledgerRequestId.current) setLoadError(err.message); });
    } catch (err) {
      setError(err.message); // e.g. missing-reason refusal (LMS-054/BR-15)
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

              {!confirming ? (
                <PrimaryButton onClick={() => setConfirming(true)} disabled={!quantity || !reason.trim()} className="w-full">
                  Review adjustment
                </PrimaryButton>
              ) : (
                <div className="space-y-2">
                  <p className="small text-warning">Confirm: {quantity} day(s), balance will become {projectedBalance.toFixed(1)}.</p>
                  <PrimaryButton onClick={submit} disabled={saving} className="w-full">{saving ? 'Posting…' : 'Confirm adjustment'}</PrimaryButton>
                </div>
              )}
            </>
          )}
        </div>
      </GlassCard>

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
                  <p className="muted small">{new Date(entry.created_at).toLocaleDateString()} · {entry.source_reference}</p>
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
