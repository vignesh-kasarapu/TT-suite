import { useState } from 'react';
import { UserX, Repeat } from 'lucide-react';
import { deactivateEmployee, reassignManager } from '../../api/employees';
import { GhostButton, PrimaryButton, DangerButton } from '../common/GlassButton';

export default function EmployeeLifecycleActions({ employee, allEmployees, onChange }) {
  const [mode, setMode] = useState(null); // null | 'deactivate' | 'reassign'
  const [lastWorkingDay, setLastWorkingDay] = useState('');
  const [newManagerId, setNewManagerId] = useState('');
  const [transferPending, setTransferPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (employee.status !== 'ACTIVE') {
    return <p className="small muted">Deactivated {employee.deactivated_at}</p>;
  }

  const submitDeactivate = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await deactivateEmployee(employee.employee_id, lastWorkingDay);
      setMode(null);
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitReassign = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await reassignManager(employee.employee_id, newManagerId, transferPending);
      setMode(null);
      onChange();
    } catch (err) {
      setError(err.message); // e.g. circular hierarchy refusal
    } finally {
      setSaving(false);
    }
  };

  if (mode === 'deactivate') {
    return (
      <form onSubmit={submitDeactivate} className="w-full p-3 rounded-md flex flex-wrap items-center gap-2 small" style={{ background: 'var(--color-danger-bg)' }}>
        <span className="muted">Last working day:</span>
        <input type="date" className="input text-xs w-36" style={{ minHeight: 36 }} value={lastWorkingDay} onChange={(e) => setLastWorkingDay(e.target.value)} required />
        <DangerButton type="submit" disabled={saving} className="btn--sm">{saving ? 'Saving…' : 'Confirm deactivation'}</DangerButton>
        <GhostButton type="button" onClick={() => setMode(null)} className="btn--sm">Cancel</GhostButton>
        {error && <p className="w-full error-msg">{error}</p>}
      </form>
    );
  }

  if (mode === 'reassign') {
    return (
      <form onSubmit={submitReassign} className="w-full p-3 rounded-md flex flex-wrap items-center gap-2 small" style={{ background: 'var(--color-tint-2)' }}>
        <select className="input text-xs w-40" style={{ minHeight: 36 }} value={newManagerId} onChange={(e) => setNewManagerId(e.target.value)} required>
          <option value="">New manager…</option>
          {allEmployees.filter((e) => e.employee_id !== employee.employee_id).map((e) => (
            <option key={e.employee_id} value={e.employee_id}>{e.full_name}</option>
          ))}
        </select>
        <label className="chk muted">
          <input type="checkbox" checked={transferPending} onChange={(e) => setTransferPending(e.target.checked)} />
          Transfer pending requests too
        </label>
        <PrimaryButton type="submit" disabled={saving} className="btn--sm">{saving ? 'Saving…' : 'Confirm'}</PrimaryButton>
        <GhostButton type="button" onClick={() => setMode(null)} className="btn--sm">Cancel</GhostButton>
        {error && <p className="w-full error-msg">{error}</p>}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <GhostButton onClick={() => setMode('reassign')} className="btn--sm">
        <Repeat className="w-3.5 h-3.5" /> Reassign manager
      </GhostButton>
      <GhostButton onClick={() => setMode('deactivate')} className="btn--sm" style={{ color: 'var(--color-danger-text)' }}>
        <UserX className="w-3.5 h-3.5" /> Deactivate
      </GhostButton>
    </div>
  );
}
