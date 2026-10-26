import { useEffect, useState } from 'react';
import { DollarSign, Clock3 } from 'lucide-react';
import { createEncashment, creditCompOff, listLeaveTypesShort } from '../../api/admin';
import { listEmployees, getDashboard } from '../../api/employees';
import GlassCard from '../common/GlassCard';
import { PrimaryButton } from '../common/GlassButton';

export default function BalanceExtrasAdmin({ leaveYearId: leaveYearIdProp } = {}) {
  const [employees, setEmployees] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [fetchedLeaveYearId, setFetchedLeaveYearId] = useState(null);
  const [encashForm, setEncashForm] = useState({ employeeId: '', leaveTypeId: '', daysEncashed: '', notes: '' });
  const [compOffForm, setCompOffForm] = useState({ employeeId: '', workDate: '', hoursOrDays: '', notes: '' });
  const [encashResult, setEncashResult] = useState(null);
  const [compOffResult, setCompOffResult] = useState(null);
  const [savingEncash, setSavingEncash] = useState(false);
  const [savingCompOff, setSavingCompOff] = useState(false);

  const leaveYearId = leaveYearIdProp ?? fetchedLeaveYearId;

  useEffect(() => {
    listEmployees().then((res) => setEmployees(res.data));
    listLeaveTypesShort().then((res) => setLeaveTypes(res.data.filter((t) => !t.is_system && t.type_code !== 'COMP_OFF')));
    if (leaveYearIdProp == null) {
      getDashboard().then((res) => setFetchedLeaveYearId(res.data.leaveYear?.leave_year_id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitEncash = async (e) => {
    e.preventDefault();
    setSavingEncash(true);
    setEncashResult(null);
    try {
      await createEncashment({ ...encashForm, leaveYearId });
      setEncashResult({ ok: true, message: `Encashed ${encashForm.daysEncashed} day(s).` });
      setEncashForm((f) => ({ ...f, daysEncashed: '', notes: '' }));
    } catch (err) {
      setEncashResult({ ok: false, message: err.message }); // e.g. insufficient balance
    } finally {
      setSavingEncash(false);
    }
  };

  const submitCompOff = async (e) => {
    e.preventDefault();
    setSavingCompOff(true);
    setCompOffResult(null);
    try {
      await creditCompOff(compOffForm);
      setCompOffResult({ ok: true, message: `Credited ${compOffForm.hoursOrDays} day(s).` });
      setCompOffForm((f) => ({ ...f, hoursOrDays: '', notes: '' }));
    } catch (err) {
      setCompOffResult({ ok: false, message: err.message });
    } finally {
      setSavingCompOff(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <GlassCard>
        <h3 className="h3 mb-1 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-accent-text" /> Leave encashment
        </h3>
        <p className="small muted mb-4">Converts balance to a payable record for payroll — no salary calculation performed here.</p>
        <form onSubmit={submitEncash} className="space-y-3">
          <select className="input" value={encashForm.employeeId} onChange={(e) => setEncashForm((f) => ({ ...f, employeeId: e.target.value }))} required>
            <option value="">Employee…</option>
            {employees.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.full_name}</option>)}
          </select>
          <select className="input" value={encashForm.leaveTypeId} onChange={(e) => setEncashForm((f) => ({ ...f, leaveTypeId: e.target.value }))} required>
            <option value="">Leave type…</option>
            {leaveTypes.map((t) => <option key={t.leave_type_id} value={t.leave_type_id}>{t.type_name}</option>)}
          </select>
          <input type="number" min="0" step="0.5" className="input" placeholder="Days to encash" value={encashForm.daysEncashed}
            onChange={(e) => setEncashForm((f) => ({ ...f, daysEncashed: e.target.value }))} required />
          <input className="input" placeholder="Notes" value={encashForm.notes} onChange={(e) => setEncashForm((f) => ({ ...f, notes: e.target.value }))} />
          {encashResult && (
            <p className="small" style={{ color: encashResult.ok ? 'var(--color-success)' : 'var(--color-danger-text)' }}>{encashResult.message}</p>
          )}
          <PrimaryButton type="submit" disabled={savingEncash} className="w-full">{savingEncash ? 'Posting…' : 'Post encashment'}</PrimaryButton>
        </form>
      </GlassCard>

      <GlassCard>
        <h3 className="h3 mb-1 flex items-center gap-2">
          <Clock3 className="w-4 h-4 text-accent-text" /> Compensatory off
        </h3>
        <p className="small muted mb-4">Credit earned time off against approved out-of-hours work.</p>
        <form onSubmit={submitCompOff} className="space-y-3">
          <select className="input" value={compOffForm.employeeId} onChange={(e) => setCompOffForm((f) => ({ ...f, employeeId: e.target.value }))} required>
            <option value="">Employee…</option>
            {employees.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.full_name}</option>)}
          </select>
          <input type="date" className="input" value={compOffForm.workDate} onChange={(e) => setCompOffForm((f) => ({ ...f, workDate: e.target.value }))} required />
          <input type="number" min="0" step="0.5" className="input" placeholder="Days credited" value={compOffForm.hoursOrDays}
            onChange={(e) => setCompOffForm((f) => ({ ...f, hoursOrDays: e.target.value }))} required />
          <input className="input" placeholder="Notes (e.g. what work this compensates)" value={compOffForm.notes}
            onChange={(e) => setCompOffForm((f) => ({ ...f, notes: e.target.value }))} />
          {compOffResult && (
            <p className="small" style={{ color: compOffResult.ok ? 'var(--color-success)' : 'var(--color-danger-text)' }}>{compOffResult.message}</p>
          )}
          <PrimaryButton type="submit" disabled={savingCompOff} className="w-full">{savingCompOff ? 'Crediting…' : 'Credit comp-off'}</PrimaryButton>
        </form>
      </GlassCard>
    </div>
  );
}
