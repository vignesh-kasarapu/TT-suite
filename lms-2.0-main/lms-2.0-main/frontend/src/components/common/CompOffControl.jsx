import { useState } from 'react';
import { CalendarPlus2 } from 'lucide-react';
import { submitCompOff } from '../../api/admin';
import { GhostButton, PrimaryButton } from './GlassButton';

/** Manager-facing per-team-member control: raises a compensatory-off claim on behalf of a
 * report. It no longer credits anything directly — the claim goes to HR for final approval,
 * and only that approval writes the ledger entry (comp_off_service). Hours are what is
 * entered; 8 hours earn one day. */
export default function CompOffControl({ employeeId, employeeName, compact = false }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ workDate: '', hoursWorked: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    try {
      await submitCompOff({ employeeId, ...form });
      setResult({
        ok: true,
        message: `Claimed ${(Number(form.hoursWorked) / 8).toFixed(2)} day(s) for ${employeeName} — sent to HR for approval.`,
      });
      setForm({ workDate: '', hoursWorked: '', notes: '' });
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      compact ? (
        <button
          type="button"
          className="icon-action"
          onClick={() => setOpen(true)}
          title={`Claim comp-off for ${employeeName}`}
          aria-label={`Claim comp-off for ${employeeName}`}
        >
          <CalendarPlus2 className="w-4 h-4" />
        </button>
      ) : (
        <GhostButton onClick={() => setOpen(true)} className="!px-2.5 !py-1.5 text-xs">
          <CalendarPlus2 className="w-3.5 h-3.5" /> Comp-off
        </GhostButton>
      )
    );
  }

  return (
    <div className="w-full p-3 rounded-md space-y-2 small" style={{ background: 'var(--color-tint-2)' }}>
      <p className="muted">Claim compensatory off for {employeeName} — 8 hours = 1 day, HR approves</p>
      <form onSubmit={submit} className="flex flex-wrap gap-1.5 items-center pt-1">
        <input type="date" className="input !text-xs w-full sm:w-36" style={{ minHeight: 36 }} value={form.workDate}
          onChange={(e) => setForm((f) => ({ ...f, workDate: e.target.value }))} required />
        <input type="number" min="0" step="0.25" className="input !text-xs w-full sm:w-24" style={{ minHeight: 36 }} placeholder="Hours"
          value={form.hoursWorked} onChange={(e) => setForm((f) => ({ ...f, hoursWorked: e.target.value }))} required />
        <input className="input !text-xs flex-1 min-w-[8rem]" style={{ minHeight: 36 }} placeholder="Notes (optional)"
          value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        <PrimaryButton type="submit" disabled={saving} className="btn--sm">
          {saving ? 'Saving…' : 'Claim'}
        </PrimaryButton>
        <GhostButton type="button" onClick={() => setOpen(false)} className="btn--sm">Close</GhostButton>
      </form>
      {result && <p className={result.ok ? '' : 'error-msg'} style={result.ok ? { color: 'var(--color-success)' } : undefined}>{result.message}</p>}
    </div>
  );
}
