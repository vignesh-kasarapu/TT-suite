import { useEffect, useState } from 'react';
import { Archive, ListPlus, RotateCcw, Users } from 'lucide-react';
import {
  listLeaveTypes, createLeaveType, archiveLeaveType, restoreLeaveType, updateLeaveTypePolicy,
  listEntitlementPools, previewEntitlementChange,
} from '../../api/admin';
import GlassCard from '../common/GlassCard';
import Modal from '../common/Modal';
import EmptyState from '../common/EmptyState';
import { DangerButton, GhostButton, PrimaryButton } from '../common/GlassButton';

// Looked up by code by the system (automatic LOP conversion, comp-off credits): never archivable.
const BUILT_IN = new Set(['LOP', 'COMP_OFF']);

const empty = {
  typeCode: '', typeName: '', annualEntitlement: '', carriesForward: false, carryForwardCap: '',
  permitsHalfDay: true, permitsAttachments: false, isSickLeave: false, poolId: '',
};

export default function LeaveTypeAdmin() {
  const [types, setTypes] = useState([]);
  const [pools, setPools] = useState([]);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const [editing, setEditing] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [archiving, setArchiving] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState(null);

  const load = () => {
    listLeaveTypes().then((res) => setTypes(res.data)).catch((err) => setError(err.message));
    listEntitlementPools().then((res) => setPools(res.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const active = types.filter((t) => !t.archived_at);
  const archived = types.filter((t) => t.archived_at);
  const shown = showArchived ? archived : active;

  const quickToggle = async (t, e) => {
    e.stopPropagation();
    setTogglingId(t.leave_type_id);
    setError(null);
    try {
      await updateLeaveTypePolicy(t.leave_type_id, { isSelectableByEmployee: !t.is_selectable_by_employee });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingId(null);
    }
  };

  const restore = async (t, e) => {
    e.stopPropagation();
    setTogglingId(t.leave_type_id);
    setError(null);
    try {
      await restoreLeaveType(t.leave_type_id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingId(null);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createLeaveType({
        ...form,
        poolId: form.poolId === '' ? null : Number(form.poolId),
        carryForwardCap: form.carriesForward && form.carryForwardCap !== '' ? Number(form.carryForwardCap) : null,
      });
      // Creating a type changes policy; it credits nobody. Say so plainly, because the
      // question people ask next is "who has these days now".
      setCreated({ name: form.typeName, days: form.annualEntitlement });
      setForm(empty);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Create Form */}
      <GlassCard className="lg:col-span-2">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
          <ListPlus className="w-4 h-4 text-accent-text" />
          <h3 className="h3">New leave category</h3>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="field">
            <label>Category code</label>
            <input className="input font-mono" placeholder="e.g. PATERNITY" value={form.typeCode}
              onChange={(e) => setForm((f) => ({ ...f, typeCode: e.target.value.toUpperCase() }))} required />
          </div>
          <div className="field">
            <label>Display name</label>
            <input className="input" placeholder="Paternity Leave" value={form.typeName}
              onChange={(e) => setForm((f) => ({ ...f, typeName: e.target.value }))} required />
          </div>
          <div className="field">
            <label>Annual entitlement (days)</label>
            <input type="number" step="0.5" className="input" placeholder="12" value={form.annualEntitlement}
              onChange={(e) => setForm((f) => ({ ...f, annualEntitlement: e.target.value }))} required />
            <p className="hint">
              Granted in full to everyone who joins from now on, whatever date they join on. Nobody who is
              already employed is credited by this — that is an opening balance you approve.
            </p>
          </div>
          {pools.length > 0 && (
            <div className="field">
              <label>Shared entitlement</label>
              <select className="input" value={form.poolId}
                onChange={(e) => setForm((f) => ({ ...f, poolId: e.target.value }))}>
                <option value="">Its own entitlement</option>
                {pools.map((p) => (
                  <option key={p.pool_id} value={p.pool_id}>
                    Share {p.pool_name} ({p.annual_entitlement} days)
                  </option>
                ))}
              </select>
              <p className="hint">A pooled type draws on the pool's days instead of holding its own.</p>
            </div>
          )}

          <div className="field">
            <label>Options</label>
            <div className="choices">
              <label className="chk"><input type="checkbox" checked={form.permitsHalfDay} onChange={(e) => setForm((f) => ({ ...f, permitsHalfDay: e.target.checked }))} /> Half-day allowed</label>
              <label className="chk"><input type="checkbox" checked={form.permitsAttachments} onChange={(e) => setForm((f) => ({ ...f, permitsAttachments: e.target.checked }))} /> Attachment required</label>
              <label className="chk"><input type="checkbox" checked={form.isSickLeave} onChange={(e) => setForm((f) => ({ ...f, isSickLeave: e.target.checked }))} /> Sick rules</label>
              <label className="chk"><input type="checkbox" checked={form.carriesForward} onChange={(e) => setForm((f) => ({ ...f, carriesForward: e.target.checked }))} /> Carry-forward</label>
            </div>
          </div>

          {form.carriesForward && (
            <div className="field">
              <label>Carry-forward cap (days)</label>
              <input type="number" step="0.5" className="input" placeholder="5" value={form.carryForwardCap}
                onChange={(e) => setForm((f) => ({ ...f, carryForwardCap: e.target.value }))} />
            </div>
          )}

          {error && <p className="error-msg">{error}</p>}
          {created && (
            <p className="small" data-testid="leave-type-created">
              {created.name} created at {created.days} day(s) a year. Anyone onboarded from now on receives it in
              full; people already employed get it when you post an opening balance for them in
              Administration &gt; Opening balances.
            </p>
          )}
          <PrimaryButton type="submit" disabled={saving} className="w-full mt-3">
            {saving ? 'Creating policy…' : 'Create leave type'}
          </PrimaryButton>
        </form>
      </GlassCard>

      {/* List Display */}
      <GlassCard className="lg:col-span-3">
        <div className="flex items-center justify-between gap-2 mb-4 pb-3 border-b border-border">
          <h3 className="h3">{showArchived ? 'Archived leave types' : 'Active leave policies'}</h3>
          <div className="flex items-center gap-2">
            <span className="pill pill--accent">{active.length} active · {archived.length} archived</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Show active' : 'Show archived'}
            </button>
          </div>
        </div>

        {!shown.length ? (
          <EmptyState
            icon={Users}
            title={showArchived ? 'Nothing archived' : 'No leave types yet'}
            description={showArchived
              ? 'Archived types keep their history and can be restored.'
              : 'Nothing is created for you. Add your company’s leave types here. Two codes are reserved: '
                + 'LOP, which the automatic loss-of-pay conversion posts to, and COMP_OFF, which the '
                + 'compensatory-off workflow credits — create them if you want those features.'}
          />
        ) : (
          <div className="divide-y divide-border">
            {shown.map((t) => (
              <div
                key={t.leave_type_id}
                role="button"
                tabIndex={0}
                onClick={() => setEditing(t)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(t); } }}
                className="w-full py-4 flex flex-col items-start sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 text-left cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{t.type_name}</p>
                    <span className="pill pill--muted font-mono">{t.type_code}</span>
                    {/* LOP: also the type the automatic conversion posts to (unwithdrawn requests). */}
                    {t.is_system && <span className="pill pill--muted" title="Unpaid. Also used by the automatic loss-of-pay conversion, whether on or off.">Unpaid</span>}
                    {t.pool && <span className="pill pill--accent" title={`Draws on ${t.pool.pool_name}`}>Shares {t.pool.pool_name}</span>}
                    {t.archived_at ? (
                      <span className="pill pill--muted">Archived</span>
                    ) : (
                      /* State is always stated, not only when off — with just a "Disabled"
                         pill and a "Disable" button, the button reads like a status. */
                      <span className={`pill ${t.is_selectable_by_employee ? 'pill--success' : 'pill--danger'}`}>
                        {t.is_selectable_by_employee ? 'Active' : 'Disabled'}
                      </span>
                    )}
                  </div>
                  <p className="small muted mt-1">
                    <strong className="text-accent-text">
                      {t.pool ? `${t.pool.annual_entitlement} days/yr shared` : `${t.policy?.annual_entitlement ?? 0} days/yr`}
                    </strong>
                    {' · granted in full to new joiners'}
                    {t.policy?.carries_forward && ` · Carries forward (cap: ${t.policy.carry_forward_cap ?? 'none'} days)`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:shrink-0">
                  {t.is_sick_leave && <span className="pill pill--accent">Medical rules</span>}
                  {t.permits_attachments && <span className="pill pill--muted">Proof required</span>}
                  {t.archived_at ? (
                    <button
                      type="button"
                      onClick={(e) => restore(t, e)}
                      disabled={togglingId === t.leave_type_id}
                      title="Restore — employees can apply for it again and anyone missing the entitlement is credited"
                      className="btn btn--secondary btn--sm shrink-0 disabled:opacity-50"
                    >
                      <RotateCcw className="w-4 h-4" /> {togglingId === t.leave_type_id ? '…' : 'Restore'}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={(e) => quickToggle(t, e)}
                        disabled={togglingId === t.leave_type_id}
                        title={
                          t.is_selectable_by_employee
                            ? 'Turn off — employees will no longer be able to apply for this leave type'
                            : 'Turn on — employees will be able to apply for this leave type again'
                        }
                        className="btn btn--secondary btn--sm shrink-0 disabled:opacity-50"
                      >
                        {togglingId === t.leave_type_id ? '…' : t.is_selectable_by_employee ? 'Turn off' : 'Turn on'}
                      </button>
                      {!t.is_system && !BUILT_IN.has(t.type_code) && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setArchiving(t); }}
                          title="Archive this leave type"
                          aria-label={`Archive ${t.type_name}`}
                          data-testid={`archive-leave-type-${t.type_code}`}
                          className="btn btn--ghost btn--sm shrink-0"
                        >
                          <Archive className="w-4 h-4" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {archiving && (
        <ArchiveLeaveTypeModal
          leaveType={archiving}
          onClose={() => setArchiving(null)}
          onArchived={() => { setArchiving(null); load(); }}
        />
      )}

      {editing && (
        <LeaveTypeEditModal
          leaveType={editing}
          pools={pools}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

/** Archiving is a soft delete: the type leaves every list employees see and keeps all of its
 *  history. Restoring it brings it back as the same type. */
function ArchiveLeaveTypeModal({ leaveType, onClose, onArchived }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const archive = async () => {
    setBusy(true);
    setError(null);
    try {
      await archiveLeaveType(leaveType.leave_type_id);
      onArchived();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Archive ${leaveType.type_name}?`} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="small">
          <span className="pill pill--muted font-mono">{leaveType.type_code}</span> disappears from Apply Leave,
          every dashboard and My Team. Requests, balances and reports that already name it are untouched, and you
          can restore it from the Archived view at any time.
        </p>
        {error && <p className="error-msg">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <GhostButton onClick={onClose} disabled={busy}>Cancel</GhostButton>
          <DangerButton onClick={archive} disabled={busy} data-testid="leave-type-archive-confirm">
            {busy ? 'Archiving…' : 'Archive'}
          </DangerButton>
        </div>
      </div>
    </Modal>
  );
}

function LeaveTypeEditModal({ leaveType, pools = [], onClose, onSaved }) {
  const [values, setValues] = useState({
    annualEntitlement: leaveType.policy?.annual_entitlement ?? '',
    carriesForward: !!leaveType.policy?.carries_forward,
    carryForwardCap: leaveType.policy?.carry_forward_cap ?? '',
    isSelectableByEmployee: leaveType.is_selectable_by_employee,
    genderEligibility: leaveType.gender_eligibility || 'ALL',
    maritalEligibility: leaveType.marital_eligibility || 'ANY',
    poolId: leaveType.pool?.pool_id ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [impact, setImpact] = useState(null);
  // Unpaid types (LOP) and types without a policy row (e.g. Comp Off) have no entitlement to edit.
  const hasEntitlement = !!leaveType.policy && leaveType.is_balance_affecting !== false;
  const changedEntitlement =
    hasEntitlement && values.annualEntitlement !== '' &&
    Number(values.annualEntitlement) !== Number(leaveType.policy?.annual_entitlement);

  // What the new number would mean for people who already hold a balance. Nothing is
  // written: existing employees move only through Balance adjustment.
  useEffect(() => {
    if (!changedEntitlement) { setImpact(null); return undefined; }
    let cancelled = false;
    const id = setTimeout(() => {
      previewEntitlementChange(leaveType.leave_type_id, Number(values.annualEntitlement))
        .then((res) => { if (!cancelled) setImpact(res.data); })
        .catch(() => {});
    }, 400);
    return () => { cancelled = true; clearTimeout(id); };
  }, [changedEntitlement, values.annualEntitlement, leaveType.leave_type_id]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // Blank cap = no cap: send an explicit null instead of "" (which the API rejects).
      const cap = values.carriesForward && values.carryForwardCap !== '' ? Number(values.carryForwardCap) : null;
      await updateLeaveTypePolicy(leaveType.leave_type_id, {
        ...values,
        annualEntitlement: values.annualEntitlement === '' ? undefined : Number(values.annualEntitlement),
        poolId: values.poolId === '' ? null : Number(values.poolId),
        carryForwardCap: cap,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={leaveType.type_name} maxWidth="max-w-md">
      {(
        <div className="space-y-4">
          {hasEntitlement ? (
            <>
              <div className="field">
                <label className="req">Annual entitlement (days)</label>
                <input type="number" step="0.5" className="input" value={values.annualEntitlement} required
                  onChange={(e) => setValues((v) => ({ ...v, annualEntitlement: e.target.value }))} />
                <p className="hint">
                  Applies to everyone granted from now on. People who already hold a balance keep it —
                  move them in Balance adjustment, where you can preview the change first.
                </p>
              </div>
              {impact && (
                <p className="small muted" data-testid="entitlement-impact">
                  {impact.employees.length} employee(s) hold {impact.target_name} today; this would differ from what
                  they hold by {impact.employees.filter((r) => r.difference !== 0).length} case(s).
                </p>
              )}
              {pools.length > 0 && (
                <div className="field">
                  <label>Shared entitlement</label>
                  <select className="input" value={values.poolId}
                    onChange={(e) => setValues((v) => ({ ...v, poolId: e.target.value }))}>
                    <option value="">Its own entitlement</option>
                    {pools.map((p) => (
                      <option key={p.pool_id} value={p.pool_id}>{p.pool_name} ({p.annual_entitlement} days)</option>
                    ))}
                  </select>
                </div>
              )}
              <label className="chk">
                <input type="checkbox" checked={values.carriesForward} onChange={(e) => setValues((s) => ({ ...s, carriesForward: e.target.checked }))} />
                Carry-forward
              </label>
              {values.carriesForward && (
                <div className="field">
                  <label>Carry-forward cap (days)</label>
                  <input type="number" step="0.5" className="input" value={values.carryForwardCap}
                    onChange={(e) => setValues((v) => ({ ...v, carryForwardCap: e.target.value }))} />
                </div>
              )}
            </>
          ) : (
            <p className="small muted">
              {leaveType.is_balance_affecting === false
                ? 'Unpaid leave: no entitlement or balance. Turn it on below to let employees apply for it; you can also tick it per person in Employees > Edit > Applicable leave types.'
                : 'This type has no entitlement policy.'}
            </p>
          )}

          <div className="grid2">
            <div className="field">
              <label>Who can apply</label>
              <select className="input" value={values.genderEligibility}
                onChange={(e) => setValues((v) => ({ ...v, genderEligibility: e.target.value }))}>
                <option value="ALL">Everyone</option>
                <option value="FEMALE">Women only</option>
                <option value="MALE">Men only</option>
              </select>
            </div>
            <div className="field">
              <label>Marital status</label>
              <select className="input" value={values.maritalEligibility}
                onChange={(e) => setValues((v) => ({ ...v, maritalEligibility: e.target.value }))}>
                <option value="ANY">Any</option>
                <option value="MARRIED">Married only</option>
                <option value="SINGLE">Single only</option>
              </select>
            </div>
          </div>
          <p className="hint">
            A restricted type is greyed out in Apply Leave for anyone it does not apply to, with
            the reason. Gender and marital status come from the person's TT Suite profile, and
            someone with nothing on record is never blocked.
          </p>

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-border">
            <div>
              <p className="text-sm font-medium">Employees can apply for this leave type</p>
              <p className="small muted mt-0.5">Disabling removes it from the Apply Leave picker for everyone.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={values.isSelectableByEmployee}
              aria-label="Employees can apply for this leave type"
              onClick={() => setValues((v) => ({ ...v, isSelectableByEmployee: !v.isSelectableByEmployee }))}
              className="switch shrink-0"
            />
          </div>

          {error && <p className="error-msg">{error}</p>}
          <PrimaryButton onClick={save} disabled={saving} className="w-full mt-2">
            {saving ? 'Saving…' : 'Save changes'}
          </PrimaryButton>
        </div>
      )}
    </Modal>
  );
}
