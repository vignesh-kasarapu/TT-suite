import { useState } from 'react';
import { CalendarPlus2 } from 'lucide-react';
import { creditCompOff } from '../../api/admin';
import { GhostButton, PrimaryButton } from './GlassButton';

/** Manager-facing per-team-member control to credit compensatory off — same backend
 * endpoint BalanceExtrasAdmin.jsx (HR/Admin) uses, scoped server-side to the manager's own
 * reporting hierarchy (r3.controller.js#compOff.credit). */
export default function CompOffControl({ employeeId, employeeName }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ workDate: '', hoursOrDays: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    try {
      await creditCompOff({ employeeId, ...form });
      setResult({ ok: true, message: `Credited ${form.hoursOrDays} day(s) for ${employeeName}.` });
      setForm({ workDate: '', hoursOrDays: '', notes: '' });
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <GhostButton onClick={() => setOpen(true)} className="!px-2.5 !py-1.5 text-xs">
        <CalendarPlus2 className="w-3.5 h-3.5" /> Comp-off
      </GhostButton>
    );
  }

  return (
    <div className="w-full p-3 rounded-md space-y-2 small" style={{ background: 'var(--color-tint-2)' }}>
      <p className="muted">Credit compensatory off for {employeeName}</p>
      <form onSubmit={submit} className="flex flex-wrap gap-1.5 items-center pt-1">
        <input type="date" className="input !text-xs w-36" style={{ minHeight: 36 }} value={form.workDate}
          onChange={(e) => setForm((f) => ({ ...f, workDate: e.target.value }))} required />
        <input type="number" min="0" step="0.5" className="input !text-xs w-24" style={{ minHeight: 36 }} placeholder="Days"
          value={form.hoursOrDays} onChange={(e) => setForm((f) => ({ ...f, hoursOrDays: e.target.value }))} required />
        <input className="input !text-xs flex-1 min-w-[8rem]" style={{ minHeight: 36 }} placeholder="Notes (optional)"
          value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        <PrimaryButton type="submit" disabled={saving} className="btn--sm">
          {saving ? 'Saving…' : 'Credit'}
        </PrimaryButton>
        <GhostButton type="button" onClick={() => setOpen(false)} className="btn--sm">Close</GhostButton>
      </form>
      {result && <p className={result.ok ? '' : 'error-msg'} style={result.ok ? { color: 'var(--color-success)' } : undefined}>{result.message}</p>}
    </div>
  );
}
