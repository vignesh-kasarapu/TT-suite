import { useEffect, useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import {
  listRestrictions, createRestriction, cancelRestriction, releaseExpiredRestrictions,
  listEntitlementPools, listLeaveTypes,
} from '../../api/admin';
import { listEmployees } from '../../api/employees';
import GlassCard from '../common/GlassCard';
import EmptyState from '../common/EmptyState';
import Modal from '../common/Modal';
import { DangerButton, GhostButton, PrimaryButton } from '../common/GlassButton';
import { useToast } from '../../context/ToastContext';

const empty = { employeeId: '', target: '', days: '', startDate: '', endDate: '', reason: '' };

const STATE_PILL = {
  ACTIVE: 'pill--danger',
  SCHEDULED: 'pill--accent',
  EXPIRED: 'pill--muted',
  CANCELLED: 'pill--muted',
};

/** Temporarily holds days back from an employee's available balance.
 *
 *  This is not leave: it never counts as usage and it never reduces the entitlement. The
 *  days come back on the end date by themselves — the nightly sweep only writes that down,
 *  so a late or failed job can never leave somebody blocked. */
export default function RestrictionAdmin() {
  const [rows, setRows] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [types, setTypes] = useState([]);
  const [pools, setPools] = useState([]);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Calling a restriction off needs a reason, so it asks for one in a dialog of our own —
  // never the browser's prompt box, which freezes the page and ignores the theme.
  const [cancelling, setCancelling] = useState(null);
  const toast = useToast();

  const load = () => {
    listRestrictions({}).then((res) => setRows(res.data)).catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
    listEmployees().then((res) => setEmployees(res.data)).catch(() => {});
    listLeaveTypes(false).then((res) => setTypes(res.data.filter((t) => t.is_balance_affecting && !t.pool))).catch(() => {});
    listEntitlementPools().then((res) => setPools(res.data)).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    const [kind, id] = form.target.split(':');
    try {
      await createRestriction({
        employeeId: Number(form.employeeId),
        leaveTypeId: kind === 'type' ? Number(id) : null,
        poolId: kind === 'pool' ? Number(id) : null,
        days: Number(form.days),
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason,
      });
      setForm(empty);
      toast.success('Restriction created. The days are held back only between those dates.');
      load();
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <GlassCard className="lg:col-span-2">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
          <Lock className="w-4 h-4 text-accent-text" />
          <h3 className="h3">Hold days back</h3>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="field">
            <label>Employee</label>
            <select className="input" value={form.employeeId} required
              onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}>
              <option value="">Select…</option>
              {employees.map((e) => (
                <option key={e.employee_id} value={e.employee_id}>{e.full_name} ({e.employee_code})</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Leave type or shared entitlement</label>
            <select className="input" value={form.target} required
              onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}>
              <option value="">Select…</option>
              {pools.map((p) => <option key={`pool-${p.pool_id}`} value={`pool:${p.pool_id}`}>{p.pool_name} (shared)</option>)}
              {types.map((t) => <option key={`type-${t.leave_type_id}`} value={`type:${t.leave_type_id}`}>{t.type_name}</option>)}
            </select>
            <p className="hint">A pooled type is restricted at its pool, so the same days are never held twice.</p>
          </div>
          <div className="field">
            <label>Days to hold back</label>
            <input type="number" step="0.5" min="0.5" className="input" value={form.days} required
              onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} />
          </div>
          <div className="grid2">
            <div className="field">
              <label>From</label>
              <input type="date" className="input" value={form.startDate} required
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            </div>
            <div className="field">
              <label>Until</label>
              <input type="date" className="input" value={form.endDate} required
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
            </div>
          </div>
          <div className="field">
            <label>Reason</label>
            <textarea className="input" rows={2} value={form.reason} required
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <PrimaryButton type="submit" disabled={saving} className="w-full">
            {saving ? 'Saving…' : 'Hold days back'}
          </PrimaryButton>
        </form>
      </GlassCard>

      <GlassCard className="lg:col-span-3">
        <div className="flex items-center justify-between gap-2 mb-4 pb-3 border-b border-border">
          <h3 className="h3">Restrictions</h3>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={async () => {
              try {
                const res = await releaseExpiredRestrictions();
                toast.success(
                  res.data.released
                    ? `${res.data.released} expired restriction(s) written off.`
                    : 'Nothing to tidy up: no expired restriction is still marked active.',
                );
                load();
              } catch (err) {
                toast.error(err.message);
              }
            }}
          >
            <Unlock className="w-4 h-4" /> Tidy up expired
          </button>
        </div>
        {!rows.length ? (
          <EmptyState icon={Lock} title="No restrictions" description="Nobody has days held back this leave year." />
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <div key={r.restriction_id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{r.employee_name}</p>
                    <span className="pill pill--muted">{r.target_name}</span>
                    <span className={`pill ${STATE_PILL[r.effective_state] || 'pill--muted'}`}>
                      {r.effective_state === 'SCHEDULED' ? 'Starts later' : r.effective_state.toLowerCase()}
                    </span>
                  </div>
                  <p className="small muted mt-1">
                    <strong className="text-accent-text">{r.days} day(s)</strong> · {r.start_date} → {r.end_date} · {r.reason}
                    {r.cancellation_reason && ` · cancelled: ${r.cancellation_reason}`}
                  </p>
                </div>
                {r.state !== 'CANCELLED' && r.effective_state !== 'EXPIRED' && (
                  <button type="button" className="btn btn--ghost btn--sm shrink-0" onClick={() => setCancelling(r)}>
                    Call it off
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {cancelling && (
        <CancelRestrictionModal
          restriction={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={(message) => { setCancelling(null); toast.success(message); load(); }}
          onFailed={(message) => toast.error(message)}
        />
      )}
    </div>
  );
}

/** Asks why the restriction is being called off. The reason is recorded on the restriction
 *  and in the audit log, so it is required — hence a dialog rather than a confirmation. */
function CancelRestrictionModal({ restriction, onClose, onCancelled, onFailed }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await cancelRestriction(restriction.restriction_id, reason.trim());
      onCancelled(
        `${restriction.days} day(s) of ${restriction.target_name} are available to ${restriction.employee_name} again.`,
      );
    } catch (err) {
      onFailed(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Call off the restriction on ${restriction.employee_name}?`} maxWidth="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <p className="small muted">
          <strong className="text-accent-text">{restriction.days} day(s)</strong> of {restriction.target_name},
          held back {restriction.start_date} → {restriction.end_date}. Calling it off makes them available
          immediately; the restriction and this reason stay on record.
        </p>
        <div className="field">
          <label htmlFor="cancel-reason" className="req">Reason</label>
          <textarea
            id="cancel-reason"
            className="input"
            rows={3}
            value={reason}
            required
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is it being called off?"
          />
        </div>
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose} disabled={busy}>Keep it</GhostButton>
          <DangerButton type="submit" disabled={busy || !reason.trim()}>
            {busy ? 'Calling it off…' : 'Call it off'}
          </DangerButton>
        </div>
      </form>
    </Modal>
  );
}
