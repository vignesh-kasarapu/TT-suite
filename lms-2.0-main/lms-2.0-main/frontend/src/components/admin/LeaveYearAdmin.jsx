import { useCallback, useEffect, useState } from 'react';
import { CalendarRange, AlertTriangle, Check } from 'lucide-react';
import { listLeaveYears, createLeaveYear, previewCarryForward } from '../../api/admin';
import GlassCard from '../common/GlassCard';
import { PrimaryButton } from '../common/GlassButton';

/** Leave years and the transition between them.
 *
 * The leave-year start setting is pending by nature: it says where the NEXT year begins and
 * never moves the one in force. Creating the next year is a deliberate act with dates HR
 * chooses — a change from April-March to January-December needs a transition period nobody
 * can infer — and it does not switch to it. Carry-forward does that, once the closing year's
 * balances have been carried or lapsed.
 */
export default function LeaveYearAdmin() {
  const [state, setState] = useState(null);
  const [form, setForm] = useState({ startDate: '', endDate: '' });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  // What carry-forward would do to the year in force, before anybody runs it.
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(() => {
    listLeaveYears()
      .then((res) => {
        setState(res.data);
        if (res.data.proposed_next) {
          setForm((f) => (f.startDate || f.endDate
            ? f
            : { startDate: res.data.proposed_next.start_date, endDate: res.data.proposed_next.end_date }));
        }
      })
      .catch((err) => setResult({ ok: false, message: err.message }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    try {
      const res = await createLeaveYear(form);
      setResult({ ok: true, message: `Created ${res.data.year_code}. It becomes current when carry-forward runs.` });
      setForm({ startDate: '', endDate: '' });
      load();
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (!state) return <GlassCard><p className="small muted">Loading leave years…</p></GlassCard>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <GlassCard>
        <h3 className="h3 mb-1 flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-accent-text" /> Leave years
        </h3>
        <p className="small muted mb-4">
          Changes apply from the next leave year only. The current leave year and historical balances will not be changed.
        </p>

        <div className="calc mb-3">
          <span className="muted small">Current leave year</span>
          <b className="num">{state.current ? state.current.year_code : '—'}</b>
          {state.current && (
            <span className="muted small">{state.current.start_date} → {state.current.end_date}</span>
          )}
        </div>

        <div className="panel-row mb-3">
          <div className="min-w-0">
            <span className="when">Configured start (MM-DD)</span>
            <p className="what">
              {state.configured_start_month_day}
              {state.pending_change
                ? ' — pending: it applies to the next leave year you create'
                : ' — matches the current leave year'}
            </p>
          </div>
          <span className={`pill ${state.pending_change ? 'pill--warning' : 'pill--success'}`}>
            {state.pending_change ? 'Pending' : 'In force'}
          </span>
        </div>

        {state.transition_required && (
          <div className="alert alert--warning" role="status">
            <AlertTriangle />
            <p>
              The configured start no longer matches the leave year in force, and no next year exists yet.
              Creating one is a transition that HR must approve: the dates below are a suggestion only, and a
              change of year shape usually needs a shortened transition period.
            </p>
          </div>
        )}

        <div className="panel-row mb-3">
          <div className="min-w-0">
            <span className="when">Year-end carry-forward</span>
            <p className="what">
              {preview
                ? `${preview.employees} employee(s) · ${preview.total_carried} day(s) would carry, ${preview.total_lapsing} would lapse`
                : 'See what would carry forward and what would lapse. Nothing is written.'}
            </p>
          </div>
          <button type="button" className="btn btn--secondary btn--sm" disabled={!state.current || previewing}
            onClick={async () => {
              setPreviewing(true);
              try {
                const res = await previewCarryForward(state.current.leave_year_id);
                setPreview(res.data);
              } catch (err) {
                setResult({ ok: false, message: err.message });
              } finally {
                setPreviewing(false);
              }
            }}>
            {previewing ? 'Working…' : 'Preview'}
          </button>
        </div>

        {preview && preview.rows.length > 0 && (
          <ul className="list mb-3">
            {preview.rows.slice(0, 8).map((r) => (
              <li key={`${r.employee_id}-${r.target_key}`}>
                <span className="date num">{r.carried}</span>
                <span className="truncate">{r.employee_name} · {r.target_name} · {r.lapsing} lapsing</span>
              </li>
            ))}
            {preview.rows.length > 8 && <li><span className="truncate muted">and {preview.rows.length - 8} more…</span></li>}
          </ul>
        )}

        <h4 className="small font-medium mt-4 mb-2">All leave years</h4>
        <ul className="list">
          {state.years.map((y) => (
            <li key={y.leave_year_id}>
              <span className="date num">{y.start_date}</span>
              <span className="truncate">{y.year_code} · to {y.end_date}</span>
              <span className={`pill ${y.is_current ? 'pill--accent' : y.is_closed ? 'pill--muted' : 'pill--holiday'}`}>
                {y.is_current ? 'Current' : y.is_closed ? 'Closed' : 'Open'}
              </span>
            </li>
          ))}
        </ul>
      </GlassCard>

      <GlassCard>
        <h3 className="h3 mb-1">Create the next leave year</h3>
        <p className="small muted mb-4">
          Dates are yours to decide — nothing is derived automatically. The new year is created closed to
          traffic (<span className="num">is_current</span> stays false) and only becomes current when
          carry-forward closes the one before it.
        </p>

        {state.next && (
          <div className="alert alert--info mb-3" role="status">
            <Check />
            <p>
              The next year already exists: <b>{state.next.year_code}</b> ({state.next.start_date} → {state.next.end_date}).
              Run carry-forward to close {state.current?.year_code} and switch to it.
            </p>
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <div className="field">
            <label htmlFor="ly-start">Start date</label>
            <input id="ly-start" type="date" className="input" required value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="ly-end">End date</label>
            <input id="ly-end" type="date" className="input" required value={form.endDate}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </div>
          {result && (
            <p className="small" style={{ color: result.ok ? 'var(--color-success)' : 'var(--color-danger-text)' }}>
              {result.message}
            </p>
          )}
          <PrimaryButton type="submit" disabled={saving} className="w-full">
            {saving ? 'Creating…' : 'Create leave year'}
          </PrimaryButton>
        </form>
      </GlassCard>
    </div>
  );
}
