import { useEffect, useState } from 'react';
import { ShieldAlert, Users } from 'lucide-react';
import { listSelfApprovalGrants, grantSelfApproval, revokeSelfApproval } from '../../api/admin';
import { listEmployees } from '../../api/employees';
import GlassCard from '../common/GlassCard';
import EmptyState from '../common/EmptyState';
import { PrimaryButton, GhostButton } from '../common/GlassButton';

export default function SelfApprovalAdmin() {
  const [grants, setGrants] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ employeeId: '', effectiveFrom: '', effectiveTo: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = () => {
    listSelfApprovalGrants().then((res) => setGrants(res.data)).catch((err) => setError(err.message));
    listEmployees().then((res) => setEmployees(res.data)).catch((err) => setError(err.message));
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await grantSelfApproval(form);
      setForm({ employeeId: '', effectiveFrom: '', effectiveTo: '', notes: '' });
      load();
    } catch (err) {
      setError(err.message); // e.g. "already has an active grant" from the service-layer uniqueness check
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <GlassCard className="lg:col-span-2">
        <h3 className="h3 mb-1 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-accent-text" /> Grant self-approval
        </h3>
        <p className="small muted mb-4">
          Controlled addendum: only applies where the employee has no reporting manager on record.
          One active grant per employee at a time.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <div className="field">
            <label>Employee</label>
            <select className="input" value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} required>
              <option value="">Select employee</option>
              {employees.map((emp) => <option key={emp.employee_id} value={emp.employee_id}>{emp.full_name}</option>)}
            </select>
          </div>
          <div className="grid2">
            <div className="field">
              <label>Effective from</label>
              <input type="date" className="input" value={form.effectiveFrom} onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))} required />
            </div>
            <div className="field">
              <label>Effective to</label>
              <input type="date" className="input" placeholder="Open-ended" value={form.effectiveTo} onChange={(e) => setForm((f) => ({ ...f, effectiveTo: e.target.value }))} />
            </div>
          </div>
          <div className="field">
            <label>Notes</label>
            <textarea className="input" placeholder="Why this grant exists" value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <PrimaryButton type="submit" disabled={saving} className="w-full">{saving ? 'Saving…' : 'Grant permission'}</PrimaryButton>
        </form>
      </GlassCard>

      <GlassCard className="lg:col-span-3">
        <h3 className="h3 mb-4">Grants</h3>
        {!grants.length ? (
          <EmptyState icon={Users} title="No grants yet" description="Self-approval grants will appear here." />
        ) : (
          <div className="divide-y divide-border">
            {grants.map((g) => (
              <div key={g.self_approval_permission_id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm">{g.grantee?.full_name}</p>
                  <p className="small muted">
                    {g.effective_from} → {g.effective_to || 'open-ended'} · granted by {g.grantedBy?.full_name}
                  </p>
                </div>
                {g.is_active ? (
                  <GhostButton onClick={() => revokeSelfApproval(g.self_approval_permission_id).then(load).catch((err) => setError(err.message))} className="btn--sm">Revoke</GhostButton>
                ) : (
                  <span className="small muted">Revoked</span>
                )}
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
