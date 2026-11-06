import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, Check, X, CalendarPlus2, AlertTriangle, Users } from 'lucide-react';
import { submitCompOff, getMyCompOff, listPendingCompOff, decideCompOff } from '../api/admin';
import { getDashboard } from '../api/employees';
import { useAuth } from '../context/AuthContext';
import GlassCard from '../components/common/GlassCard';
import EmptyState from '../components/common/EmptyState';
import { PrimaryButton, GhostButton } from '../components/common/GlassButton';
import Topbar from '../components/layout/Topbar';

/** The approved conversion: 8 hours of extra work earn one comp-off day, proportionally —
 * 2 hours is 0.25 of a day, never rounded up. The backend applies the same rule; this is
 * only so the employee sees what they are claiming before they submit it. */
const HOURS_PER_DAY = 8;
const daysForHours = (hours) => Math.round((Number(hours) / HOURS_PER_DAY) * 100) / 100;

const STATUS_PILL = {
  PENDING_MANAGER: 'pill--accent',
  PENDING_HR: 'pill--warning',
  APPROVED: 'pill--success',
  REJECTED: 'pill--danger',
};
const statusLabel = (status) => status.replaceAll('_', ' ').toLowerCase();

export default function CompOff() {
  const { user, hasRole } = useAuth();
  const isManager = hasRole('MANAGER', 'HR_ADMIN');
  const [form, setForm] = useState({ workDate: '', hoursWorked: '', notes: '' });
  const [mine, setMine] = useState([]);
  const [queue, setQueue] = useState([]);
  const [balance, setBalance] = useState(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [busyId, setBusyId] = useState(null);
  // Comp-off is a leave type an administrator creates, like any other. Until one exists with
  // the code COMP_OFF there is nothing to claim against, so the claim form is not shown.
  const [configured, setConfigured] = useState(true);

  const load = useCallback(() => {
    getMyCompOff().then((res) => setMine(res.data)).catch(() => {});
    getDashboard()
      .then((res) => {
        const card = (res.data.balances || []).find((b) => b.targetCode === 'COMP_OFF') || null;
        setBalance(card);
        setConfigured(!!card || (res.data.leaveTypes || []).some((t) => t.type_code === 'COMP_OFF'));
      })
      .catch(() => {});
    if (isManager) listPendingCompOff().then((res) => setQueue(res.data)).catch(() => {});
  }, [isManager]);
  useEffect(() => { load(); }, [load]);

  const claimedDays = useMemo(() => (form.hoursWorked ? daysForHours(form.hoursWorked) : 0), [form.hoursWorked]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    try {
      await submitCompOff({
        employeeId: user.employee.employee_id,
        workDate: form.workDate, hoursWorked: form.hoursWorked, notes: form.notes,
      });
      setResult({ ok: true, message: `Claimed ${claimedDays} day(s) — sent to your manager.` });
      setForm({ workDate: '', hoursWorked: '', notes: '' });
      load();
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const decide = async (id, approve) => {
    setBusyId(id);
    setResult(null);
    try {
      await decideCompOff(id, approve, null);
      setResult({ ok: true, message: approve ? 'Approved — sent to HR for final approval.' : 'Rejected.' });
      load();
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Topbar title="Compensatory Off" />

      <div className="page-hero">
        <div className="flex items-center gap-4 min-w-0">
          <span className="ico"><Clock3 /></span>
          <div className="min-w-0">
            <h1>Compensatory off</h1>
            <p>Claim time off for approved extra work. 8 hours earn one comp-off day; your manager and HR both approve before it is credited.</p>
          </div>
        </div>
        {balance && (
          <span className="pill pill--accent">
            <CalendarPlus2 className="w-3.5 h-3.5" /> {balance.effectiveBalance.toFixed(2)} day(s) available
          </span>
        )}
      </div>

      {result && (
        <div className={`alert ${result.ok ? 'alert--success' : 'alert--danger'}`} role="status">
          {result.ok ? <Check /> : <AlertTriangle />}
          <p>{result.message}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {configured && (
        <GlassCard>
          <h3 className="h3 mb-1">Claim extra work</h3>
          <p className="small muted mb-4">Enter the hours you actually worked; the day figure is worked out for you.</p>
          <form onSubmit={submit} className="space-y-3">
            <div className="field">
              <label htmlFor="co-date">Work date</label>
              <input id="co-date" type="date" className="input" required value={form.workDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setForm((f) => ({ ...f, workDate: e.target.value }))} />
            </div>
            <div className="field">
              <label htmlFor="co-hours">Extra hours worked</label>
              <input id="co-hours" type="number" min="0" step="0.25" className="input" required value={form.hoursWorked}
                onChange={(e) => setForm((f) => ({ ...f, hoursWorked: e.target.value }))} />
            </div>
            {form.hoursWorked && (
              <div className="calc">
                <span className="muted small">Comp-off earned ({HOURS_PER_DAY} hours = 1 day)</span>
                <b className="num">{claimedDays}</b>
              </div>
            )}
            <div className="field">
              <label htmlFor="co-notes">What the work was</label>
              <input id="co-notes" className="input" placeholder="e.g. Saturday release support" value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <PrimaryButton type="submit" disabled={saving} className="w-full">
              {saving ? 'Submitting…' : 'Submit claim'}
            </PrimaryButton>
          </form>
        </GlassCard>
        )}

        <GlassCard>
          <h3 className="h3 mb-4">My claims</h3>
          {!mine.length ? (
            <EmptyState icon={Clock3} title="No claims yet" description="Extra work you claim will appear here with its approval status." />
          ) : (
            <div className="space-y-2">
              {mine.map((r) => (
                <div key={r.comp_off_id} className="panel-row">
                  <div className="min-w-0">
                    <span className="when">{r.work_date}</span>
                    <p className="what">
                      <span className="num">{r.hours_worked ?? '—'}</span> hour(s) → <span className="num">{r.hours_or_days}</span> day(s)
                      {r.manager_decided_at ? ' · manager decided' : ''}
                      {r.hr_decided_at ? ' · HR decided' : ''}
                    </p>
                  </div>
                  <span className={`pill ${STATUS_PILL[r.status] || 'pill--muted'}`}>{statusLabel(r.status)}</span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {isManager && (
        <GlassCard>
          <h3 className="h3 mb-1 flex items-center gap-2">
            <Users className="w-4 h-4 text-accent-text" /> Awaiting your decision ({queue.length})
          </h3>
          <p className="small muted mb-4">
            Claims you can decide: your reporting line's, plus anything at the HR stage if you are HR.
            A manager's approval sends the claim to HR; the HR approval credits the balance.
          </p>
          {!queue.length ? (
            <p className="small muted">Nothing from your team is waiting.</p>
          ) : (
            <div className="space-y-2">
              {queue.map((r) => (
                <div key={r.comp_off_id} className="panel-row">
                  <div className="min-w-0">
                    <span className="when">
                      {r.employee_name}{' '}
                      <span className={`pill ${STATUS_PILL[r.status] || 'pill--muted'}`}>{statusLabel(r.status)}</span>
                    </span>
                    <p className="what">
                      {r.work_date} · <span className="num">{r.hours_worked ?? '—'}</span> hour(s)
                      {' → '}<span className="num">{r.hours_or_days}</span> day(s)
                      {r.notes ? ` · ${r.notes}` : ''}
                    </p>
                  </div>
                  <div className="actions">
                    <PrimaryButton className="btn--sm" disabled={busyId === r.comp_off_id} onClick={() => decide(r.comp_off_id, true)}>
                      <Check /> Approve
                    </PrimaryButton>
                    <GhostButton className="btn--sm" disabled={busyId === r.comp_off_id} onClick={() => decide(r.comp_off_id, false)}>
                      <X /> Reject
                    </GhostButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}
    </>
  );
}
