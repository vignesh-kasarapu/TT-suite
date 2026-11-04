import { useEffect, useState } from 'react';
import { ShieldAlert, Users } from 'lucide-react';
import { listSelfApprovalGrants, grantSelfApproval, revokeSelfApproval, listLeaveYears } from '../../api/admin';
import { listEmployees } from '../../api/employees';
import GlassCard from '../common/GlassCard';
import EmptyState from '../common/EmptyState';
import { PrimaryButton, GhostButton } from '../common/GlassButton';
import { useToast } from '../../context/ToastContext';

const today = () => new Date().toISOString().slice(0, 10);

/** How long a grant runs. Two of the three are the answers HR actually gives — "for this
 *  leave year" and "until they leave" — so neither needs a date looking up. */
const DURATIONS = [
  {
    value: 'leave_year',
    label: 'The rest of this leave year',
    describe: (year) => (year ? `Ends on ${year.end_date}, when ${year.year_code} does.` : 'Ends with the current leave year.'),
  },
  {
    value: 'until_deactivated',
    label: 'Until the employee is deactivated',
    describe: () => 'Open-ended. It ends by itself when the person is deactivated, or when you revoke it.',
  },
  {
    value: 'dates',
    label: 'Specific dates',
    describe: () => 'Exactly the dates you set below.',
  },
];

const empty = { employeeId: '', duration: 'leave_year', effectiveFrom: today(), effectiveTo: '', notes: '' };

export default function SelfApprovalAdmin() {
  const [grants, setGrants] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [leaveYear, setLeaveYear] = useState(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();

  const load = () => {
    listSelfApprovalGrants().then((res) => setGrants(res.data)).catch((err) => setError(err.message));
    listEmployees().then((res) => setEmployees(res.data)).catch((err) => setError(err.message));
    listLeaveYears().then((res) => setLeaveYear(res.data.current)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const chosen = DURATIONS.find((d) => d.value === form.duration) ?? DURATIONS[0];

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await grantSelfApproval({
        employeeId: Number(form.employeeId),
        duration: form.duration,
        effectiveFrom: form.effectiveFrom || null,
        // Only the dates option sends an end date; the presets work it out on the server.
        effectiveTo: form.duration === 'dates' && form.effectiveTo ? form.effectiveTo : null,
        notes: form.notes,
      });
      const who = employees.find((emp) => String(emp.employee_id) === String(form.employeeId));
      toast.success(`${who?.full_name || 'The employee'} can approve their own leave — ${chosen.label.toLowerCase()}.`);
      setForm({ ...empty, effectiveFrom: today() });
      load();
    } catch (err) {
      // e.g. "already has an active grant" from the service-layer uniqueness check
      setError(err.message);
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (g) => {
    try {
      await revokeSelfApproval(g.self_approval_permission_id);
      toast.success(`Self-approval revoked for ${g.grantee?.full_name || 'the employee'}.`);
      load();
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
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

          <fieldset className="field">
            <legend>How long</legend>
            <div className="choices">
              {DURATIONS.map((d) => (
                <label className="chk" key={d.value}>
                  <input
                    type="radio"
                    name="self-approval-duration"
                    value={d.value}
                    checked={form.duration === d.value}
                    onChange={() => setForm((f) => ({ ...f, duration: d.value }))}
                  />
                  {' '}{d.label}
                </label>
              ))}
            </div>
            <p className="hint">{chosen.describe(leaveYear)}</p>
          </fieldset>

          <div className={form.duration === 'dates' ? 'grid2' : 'field'}>
            <div className="field">
              <label>{form.duration === 'dates' ? 'Effective from' : 'Starts'}</label>
              <input
                type="date"
                className="input"
                value={form.effectiveFrom}
                onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
                required
              />
            </div>
            {form.duration === 'dates' && (
              <div className="field">
                <label>Effective to</label>
                <input
                  type="date"
                  className="input"
                  value={form.effectiveTo}
                  min={form.effectiveFrom || undefined}
                  onChange={(e) => setForm((f) => ({ ...f, effectiveTo: e.target.value }))}
                />
                <p className="hint">Leave it empty for an open-ended grant.</p>
              </div>
            )}
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
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{g.grantee?.full_name}</p>
                    {g.grantee?.employee_code && <span className="pill pill--muted font-mono">{g.grantee.employee_code}</span>}
                    {g.is_active && g.duration === 'until_deactivated' && (
                      <span className="pill pill--accent">Until deactivated</span>
                    )}
                  </div>
                  <p className="small muted">
                    {g.effective_from} → {g.effective_to || 'until the employee is deactivated'}
                    {g.grantedBy?.full_name ? ` · granted by ${g.grantedBy.full_name}` : ''}
                  </p>
                </div>
                {g.is_active ? (
                  <GhostButton onClick={() => revoke(g)} className="btn--sm">Revoke</GhostButton>
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
