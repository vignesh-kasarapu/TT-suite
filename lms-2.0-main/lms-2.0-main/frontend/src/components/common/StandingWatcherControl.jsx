import { useEffect, useRef, useState } from 'react';
import { Eye, Plus, ChevronDown, Check, X } from 'lucide-react';
import { listStandingWatchers, addStandingWatcher, getWatchableEmployees } from '../../api/employees';
import { GhostButton, PrimaryButton } from './GlassButton';

/** Custom listbox instead of a native <select> — a plain <option> can't carry the
 * bold-name / muted department+designation sub-text the watcher picker needs. */
function WatcherPicker({ candidates, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = candidates.find((c) => String(c.employee_id) === String(value));

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative w-full" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input !text-xs w-full flex items-center justify-between text-left"
        style={{ minHeight: 36 }}
      >
        <span className={selected ? '' : 'muted'}>
          {selected ? selected.full_name : 'Watcher…'}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 muted transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-56 max-h-64 overflow-y-auto py-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-popover)' }}>
          {candidates.map((c) => (
            <button
              key={c.employee_id}
              type="button"
              onClick={() => { onChange(c.employee_id); setOpen(false); }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
              style={{ background: 'transparent' }}
            >
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">{c.full_name}</p>
                <p className="muted truncate" style={{ fontSize: '10px' }}>
                  {[c.Department?.department_name, c.designation].filter(Boolean).join(' · ') || 'No department on record'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="muted" style={{ fontSize: '9px', fontFamily: 'monospace' }}>#{c.employee_id}</span>
                {String(value) === String(c.employee_id) && <Check className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} />}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StandingWatcherControl({ employeeId, employeeName }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [form, setForm] = useState({ watcherEmployeeId: '', fromDate: '', toDate: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = () => listStandingWatchers(employeeId).then((res) => setCurrent(res.data)).catch((err) => setError(err.message));

  useEffect(() => {
    if (open) {
      load();
      getWatchableEmployees()
        .then((res) => setCandidates(res.data.filter((c) => String(c.employee_id) !== String(employeeId))))
        .catch((err) => setError(err.message));
    }
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.watcherEmployeeId) {
      setError('Choose a watcher.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addStandingWatcher(employeeId, form);
      setForm({ watcherEmployeeId: '', fromDate: '', toDate: '' });
      load();
    } catch (err) {
      setError(err.message); // e.g. "not in your hierarchy" refusal (LMS-061 scope check)
    } finally {
      setSaving(false);
    }
  };

  // Exclude anyone who already has a non-expired standing-watcher row for this
  // employee — re-adding them (even for a different date window) is rarely
  // intentional and would otherwise create a duplicate/overlapping entry.
  const today = new Date().toISOString().slice(0, 10);
  const activeWatcherIds = new Set(
    current.filter((s) => s.to_date >= today).map((s) => String(s.watcher_employee_id))
  );
  const availableCandidates = candidates.filter((c) => !activeWatcherIds.has(String(c.employee_id)));

  if (!open) {
    return (
      <GhostButton onClick={() => setOpen(true)} className="!px-2.5 !py-1.5 text-xs">
        <Eye className="w-3.5 h-3.5" /> Standing watcher
      </GhostButton>
    );
  }

  return (
    <div className="w-full p-3 rounded-md space-y-2 small" style={{ background: 'var(--color-tint-2)' }}>
      <div className="flex items-center justify-between">
        <p className="muted">Standing watchers on {employeeName}</p>
        <button type="button" onClick={() => setOpen(false)} className="btn btn--ghost btn--sm !min-h-0 !px-1" aria-label="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {current.map((s) => (
        <div key={s.standing_watcher_id} className="rounded-sm px-2.5 py-1.5" style={{ background: 'var(--color-surface)' }}>
          {s.watcherEmployee?.full_name} · {s.from_date} → {s.to_date}
        </div>
      ))}
      <form onSubmit={submit} className="flex flex-wrap gap-1.5 items-center pt-1">
        <div className="w-40">
          <WatcherPicker
            candidates={availableCandidates}
            value={form.watcherEmployeeId}
            onChange={(id) => setForm((f) => ({ ...f, watcherEmployeeId: id }))}
          />
        </div>
        <input type="date" className="input !text-xs w-32" style={{ minHeight: 36 }} value={form.fromDate}
          onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value }))} required />
        <input type="date" className="input !text-xs w-32" style={{ minHeight: 36 }} value={form.toDate}
          onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))} required />
        <PrimaryButton type="submit" disabled={saving} className="btn--sm !px-2.5">
          <Plus className="w-3.5 h-3.5" />
        </PrimaryButton>
      </form>
      {error && <p className="error-msg">{error}</p>}
    </div>
  );
}
