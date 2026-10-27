import { useState } from 'react';
import { Repeat } from 'lucide-react';
import { reassignManager } from '../../api/employees';
import { GhostButton, PrimaryButton } from '../common/GlassButton';

/** HR's lifecycle action on an employee: reassigning the reporting manager. Deactivation
 * (removing access) is the global admin's, in the portal — ask via "Request role change"
 * with "No access". */
export default function EmployeeLifecycleActions({ employee, allEmployees, onChange }) {
  const [mode, setMode] = useState(null); // null | 'reassign'
  const [newManagerId, setNewManagerId] = useState('');
  const [transferPending, setTransferPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (employee.status !== 'ACTIVE') {
    return <p className="small muted">Deactivated {employee.deactivated_at}</p>;
  }

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
    </div>
  );
}
