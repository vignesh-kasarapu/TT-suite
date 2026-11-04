import { useEffect, useState } from 'react';
import { Layers, Trash2 } from 'lucide-react';
import {
  listEntitlementPools, createEntitlementPool, updateEntitlementPool, archiveEntitlementPool, listLeaveTypes,
} from '../../api/admin';
import GlassCard from '../common/GlassCard';
import EmptyState from '../common/EmptyState';
import Modal from '../common/Modal';
import { DangerButton, GhostButton, PrimaryButton } from '../common/GlassButton';

const empty = { poolCode: '', poolName: '', annualEntitlement: '', carriesForward: false, carryForwardCap: '', leaveTypeIds: [] };

/** Shared entitlement pools: one entitlement several leave types draw on — Sick and Casual
 *  sharing nine days is one pool with two members, so two days of sick leaves seven for
 *  either, and nobody is granted nine of each. */
export default function EntitlementPoolAdmin() {
  const [pools, setPools] = useState([]);
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [archiving, setArchiving] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = () => {
    listEntitlementPools().then((res) => setPools(res.data)).catch((err) => setError(err.message));
    listLeaveTypes(false).then((res) => setTypes(res.data.filter((t) => t.is_balance_affecting && !t.is_system))).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const toggleType = (id) =>
    setForm((f) => ({
      ...f,
      leaveTypeIds: f.leaveTypeIds.includes(id) ? f.leaveTypeIds.filter((x) => x !== id) : [...f.leaveTypeIds, id],
    }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createEntitlementPool({
        ...form,
        annualEntitlement: Number(form.annualEntitlement),
        carryForwardCap: form.carriesForward && form.carryForwardCap !== '' ? Number(form.carryForwardCap) : null,
      });
      setNotice(
        `${form.poolName} created at ${form.annualEntitlement} shared day(s) a year. New joiners receive it; `
        + 'people already employed get it through an opening balance.',
      );
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
      <GlassCard className="lg:col-span-2">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
          <Layers className="w-4 h-4 text-accent-text" />
          <h3 className="h3">New shared entitlement</h3>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="field">
            <label>Code</label>
            <input className="input font-mono" placeholder="SICK_CASUAL" value={form.poolCode} required
              onChange={(e) => setForm((f) => ({ ...f, poolCode: e.target.value.toUpperCase() }))} />
          </div>
          <div className="field">
            <label>Name</label>
            <input className="input" placeholder="Sick + Casual Leave" value={form.poolName} required
              onChange={(e) => setForm((f) => ({ ...f, poolName: e.target.value }))} />
          </div>
          <div className="field">
            <label>Shared days a year</label>
            <input type="number" step="0.5" className="input" placeholder="9" value={form.annualEntitlement} required
              onChange={(e) => setForm((f) => ({ ...f, annualEntitlement: e.target.value }))} />
            <p className="hint">
              Granted once per employee who joins from now on, however many leave types share it. Nobody
              already employed is credited by this.
            </p>
          </div>
          <div className="field">
            <label>Leave types that share it</label>
            <div className="choices">
              {types.map((t) => (
                <label className="chk" key={t.leave_type_id}>
                  <input type="checkbox" checked={form.leaveTypeIds.includes(t.leave_type_id)} onChange={() => toggleType(t.leave_type_id)} />
                  {' '}{t.type_name}
                </label>
              ))}
            </div>
          </div>
          <label className="chk">
            <input type="checkbox" checked={form.carriesForward} onChange={(e) => setForm((f) => ({ ...f, carriesForward: e.target.checked }))} />
            {' '}Carry-forward
          </label>
          {form.carriesForward && (
            <div className="field">
              <label>Carry-forward cap (days)</label>
              <input type="number" step="0.5" className="input" value={form.carryForwardCap}
                onChange={(e) => setForm((f) => ({ ...f, carryForwardCap: e.target.value }))} />
            </div>
          )}
          {error && <p className="error-msg">{error}</p>}
          {notice && <p className="small">{notice}</p>}
          <PrimaryButton type="submit" disabled={saving} className="w-full mt-2">
            {saving ? 'Creating…' : 'Create shared entitlement'}
          </PrimaryButton>
        </form>
      </GlassCard>

      <GlassCard className="lg:col-span-3">
        <div className="flex items-center justify-between gap-2 mb-4 pb-3 border-b border-border">
          <h3 className="h3">Shared entitlements</h3>
          <span className="pill pill--accent">{pools.length} configured</span>
        </div>
        {!pools.length ? (
          <EmptyState icon={Layers} title="No shared entitlements" description="Every leave type holds its own days until you create one." />
        ) : (
          <div className="divide-y divide-border">
            {pools.map((p) => (
              <div key={p.pool_id} className="py-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{p.pool_name}</p>
                    <span className="pill pill--muted font-mono">{p.pool_code}</span>
                  </div>
                  <p className="small muted mt-1">
                    <strong className="text-accent-text">{p.annual_entitlement} days/yr</strong>
                    {' shared by '}
                    {p.leave_types.map((t) => t.type_name).join(', ') || 'nothing yet'}
                    {p.carries_forward && ` · carries forward (cap: ${p.carry_forward_cap ?? 'none'})`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing(p)}>Edit</button>
                  <button type="button" className="btn btn--ghost btn--sm" aria-label={`Archive ${p.pool_name}`} onClick={() => setArchiving(p)}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {editing && (
        <PoolEditModal pool={editing} types={types} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
      {archiving && (
        <Modal open onClose={() => setArchiving(null)} title={`Archive ${archiving.pool_name}?`} maxWidth="max-w-md">
          <div className="space-y-4">
            <p className="small">
              Its member types go back to holding their own entitlement. Balances already posted against the pool
              stay exactly as they are.
            </p>
            <div className="flex justify-end gap-2">
              <GhostButton onClick={() => setArchiving(null)}>Cancel</GhostButton>
              <DangerButton onClick={async () => { await archiveEntitlementPool(archiving.pool_id); setArchiving(null); load(); }}>
                Archive
              </DangerButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PoolEditModal({ pool, types, onClose, onSaved }) {
  const [values, setValues] = useState({
    poolName: pool.pool_name,
    annualEntitlement: pool.annual_entitlement,
    carriesForward: pool.carries_forward,
    carryForwardCap: pool.carry_forward_cap ?? '',
    leaveTypeIds: pool.leave_types.map((t) => t.leave_type_id),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const toggleType = (id) =>
    setValues((v) => ({
      ...v,
      leaveTypeIds: v.leaveTypeIds.includes(id) ? v.leaveTypeIds.filter((x) => x !== id) : [...v.leaveTypeIds, id],
    }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateEntitlementPool(pool.pool_id, {
        ...values,
        annualEntitlement: Number(values.annualEntitlement),
        carryForwardCap: values.carriesForward && values.carryForwardCap !== '' ? Number(values.carryForwardCap) : null,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={pool.pool_name} maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="field">
          <label>Name</label>
          <input className="input" value={values.poolName} onChange={(e) => setValues((v) => ({ ...v, poolName: e.target.value }))} />
        </div>
        <div className="field">
          <label>Shared days a year</label>
          <input type="number" step="0.5" className="input" value={values.annualEntitlement}
            onChange={(e) => setValues((v) => ({ ...v, annualEntitlement: e.target.value }))} />
          <p className="hint">Applies to grants from now on. Existing balances move in Balance adjustment.</p>
        </div>
        <div className="field">
          <label>Leave types that share it</label>
          <div className="choices">
            {types.map((t) => (
              <label className="chk" key={t.leave_type_id}>
                <input type="checkbox" checked={values.leaveTypeIds.includes(t.leave_type_id)} onChange={() => toggleType(t.leave_type_id)} />
                {' '}{t.type_name}
              </label>
            ))}
          </div>
        </div>
        <label className="chk">
          <input type="checkbox" checked={values.carriesForward} onChange={(e) => setValues((v) => ({ ...v, carriesForward: e.target.checked }))} />
          {' '}Carry-forward
        </label>
        {values.carriesForward && (
          <div className="field">
            <label>Carry-forward cap (days)</label>
            <input type="number" step="0.5" className="input" value={values.carryForwardCap}
              onChange={(e) => setValues((v) => ({ ...v, carryForwardCap: e.target.value }))} />
          </div>
        )}
        {error && <p className="error-msg">{error}</p>}
        <PrimaryButton onClick={save} disabled={saving} className="w-full">{saving ? 'Saving…' : 'Save changes'}</PrimaryButton>
      </div>
    </Modal>
  );
}
