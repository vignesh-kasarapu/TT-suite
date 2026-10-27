import { useState } from 'react';
import { ShieldCheck, Send } from 'lucide-react';
import { requestRoleChange } from '../../api/employees';
import { GhostButton, PrimaryButton } from '../common/GlassButton';

// Suite roles for LMS ('' = "No access", sent as null).
const ROLE_OPTIONS = [
  ['employee', 'Employee'],
  ['manager', 'Manager'],
  ['admin', 'Admin (HR)'],
  ['', 'No access'],
];
const ROLE_LABEL = { employee: 'Employee', manager: 'Manager', admin: 'Admin (HR)' };

export const roleLabel = (role) => (role ? ROLE_LABEL[role] || role : 'No access');

/** The person's LMS role as the suite sees it (HR_ADMIN wins over MANAGER). */
export function currentSuiteRole(employee) {
  if (employee.status !== 'ACTIVE') return null;
  const roles = employee.roles || [];
  if (roles.includes('HR_ADMIN')) return 'admin';
  if (roles.includes('MANAGER')) return 'manager';
  return 'employee';
}

/** TT Suite: only the global admin assigns roles. HR asks for a change here; it goes to the
 * global admin's inbox in the portal and applies once approved. */
export default function RoleChangeRequest({ employee, pending, onRequested }) {
  const current = currentSuiteRole(employee);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(current || '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await requestRoleChange(employee.employee_id, role || null, note);
      setSent(true);
      setOpen(false);
      setNote('');
      onRequested?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5 muted shrink-0" />
        <span className="pill pill--muted">{roleLabel(current)}</span>
        {pending && <span className="pill pill--accent">Requested: {roleLabel(pending.role)}</span>}
        {!open && (
          <GhostButton type="button" className="btn--sm" onClick={() => { setOpen(true); setSent(false); }}>
            Request role change
          </GhostButton>
        )}
      </div>
      {sent && !open && <p className="small" role="status">Sent to the global admin for approval.</p>}
      {open && (
        <form onSubmit={submit} className="w-full p-3 rounded-md flex flex-col gap-2 small" style={{ background: 'var(--color-tint-2)' }}>
          <select className="input text-xs" style={{ minHeight: 36 }} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Requested role">
            {ROLE_OPTIONS.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
          </select>
          <input className="input text-xs" style={{ minHeight: 36 }} placeholder="Note for the global admin (optional)"
            value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          <div className="flex flex-wrap gap-2">
            <PrimaryButton type="submit" disabled={saving} className="btn--sm">
              <Send className="w-3.5 h-3.5" /> {saving ? 'Sending…' : 'Send request'}
            </PrimaryButton>
            <GhostButton type="button" onClick={() => setOpen(false)} className="btn--sm">Cancel</GhostButton>
          </div>
          {error && <p className="error-msg">{error}</p>}
        </form>
      )}
    </div>
  );
}
