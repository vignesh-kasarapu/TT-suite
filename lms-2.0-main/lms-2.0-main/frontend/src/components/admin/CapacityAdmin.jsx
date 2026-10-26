import { useEffect, useState } from 'react';
import { Ban, Users2, Trash2 } from 'lucide-react';
import {
  listBlackoutPeriods, createBlackoutPeriod, updateBlackoutPeriod, setBlackoutPeriodActive, removeBlackoutPeriod,
  listTeamCapacityLimits, createTeamCapacityLimit, updateTeamCapacityLimit, setTeamCapacityLimitActive, removeTeamCapacityLimit,
} from '../../api/admin';
import { listEmployees } from '../../api/employees';
import GlassCard from '../common/GlassCard';
import Modal from '../common/Modal';
import { PrimaryButton, GhostButton, DangerButton } from '../common/GlassButton';

// Shared across both forms/modals in this file — end date may never be before start date,
// otherwise a blackout period becomes a dead range that assertNoBlackoutConflict can never
// match (it silently blocks nothing while looking configured).
function dateRangeError(startDate, endDate) {
  return startDate && endDate && endDate < startDate ? 'End date cannot be before start date.' : null;
}

export default function CapacityAdmin() {
  const [periods, setPeriods] = useState([]);
  const [limits, setLimits] = useState([]);
  const [managers, setManagers] = useState([]);
  const [periodForm, setPeriodForm] = useState({ name: '', startDate: '', endDate: '' });
  const [capacityForm, setCapacityForm] = useState({ managerEmployeeId: '', maxConcurrentOnLeave: '', effectiveFrom: '' });
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState(null);
  const [editingLimit, setEditingLimit] = useState(null);

  const load = () => {
    listBlackoutPeriods(true).then((res) => setPeriods(res.data));
    listTeamCapacityLimits().then((res) => setLimits(res.data));
    listEmployees().then((res) => setManagers(res.data));
  };
  useEffect(() => { load(); }, []);

  const periodDateError = dateRangeError(periodForm.startDate, periodForm.endDate);

  const submitPeriod = async (e) => {
    e.preventDefault();
    if (periodDateError) return;
    setSavingPeriod(true);
    try {
      await createBlackoutPeriod(periodForm);
      setPeriodForm({ name: '', startDate: '', endDate: '' });
      load();
    } finally {
      setSavingPeriod(false);
    }
  };

  const submitCapacity = async (e) => {
    e.preventDefault();
    setSavingCapacity(true);
    try {
      await createTeamCapacityLimit(capacityForm);
      setCapacityForm({ managerEmployeeId: '', maxConcurrentOnLeave: '', effectiveFrom: '' });
      load();
    } finally {
      setSavingCapacity(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <GlassCard>
        <h3 className="h3 mb-1 flex items-center gap-2">
          <Ban className="w-4 h-4 text-accent-text" /> Blackout periods
        </h3>
        <p className="small muted mb-4">Leave cannot be applied for during these windows — this blocks submission, not just a warning.</p>
        <form onSubmit={submitPeriod} className="space-y-3 pb-4 mb-4 border-b border-border">
          <input className="input" placeholder="Name (e.g. Year-end freeze)" value={periodForm.name}
            onChange={(e) => setPeriodForm((f) => ({ ...f, name: e.target.value }))} required />
          <div className="grid2">
            <input type="date" className="input" value={periodForm.startDate} onChange={(e) => setPeriodForm((f) => ({ ...f, startDate: e.target.value }))} required />
            <input type="date" className="input" value={periodForm.endDate} onChange={(e) => setPeriodForm((f) => ({ ...f, endDate: e.target.value }))} required />
          </div>
          {periodDateError && <p className="error-msg">{periodDateError}</p>}
          <PrimaryButton type="submit" disabled={savingPeriod || !!periodDateError} className="w-full">{savingPeriod ? 'Saving…' : 'Create blackout period'}</PrimaryButton>
        </form>
        <div className="space-y-1">
          {!periods.length ? (
            <p className="small muted text-center py-4">No blackout periods configured yet.</p>
          ) : periods.map((p) => (
            <button
              type="button"
              key={p.blackout_id}
              onClick={() => setEditingPeriod(p)}
              className="w-full flex items-center justify-between small rounded-md px-3 py-2 text-left hover:bg-tint-2 transition-colors"
            >
              <div>
                <p className="flex items-center gap-2">
                  {p.name}
                  {!p.is_active && <span className="pill pill--muted">Disabled</span>}
                </p>
                <p className="muted small">{p.start_date} → {p.end_date}</p>
              </div>
            </button>
          ))}
        </div>
      </GlassCard>

      <GlassCard>
        <h3 className="h3 mb-1 flex items-center gap-2">
          <Users2 className="w-4 h-4 text-accent-text" /> Team capacity limits
        </h3>
        <p className="small muted mb-4">Cap how many of a manager's direct reports may be on leave at once.</p>
        <form onSubmit={submitCapacity} className="space-y-3 pb-4 mb-4 border-b border-border">
          <select className="input" value={capacityForm.managerEmployeeId} onChange={(e) => setCapacityForm((f) => ({ ...f, managerEmployeeId: e.target.value }))} required>
            <option value="">Manager…</option>
            {managers.map((m) => <option key={m.employee_id} value={m.employee_id}>{m.full_name}</option>)}
          </select>
          <input type="number" min="1" className="input" placeholder="Max concurrent on leave" value={capacityForm.maxConcurrentOnLeave}
            onChange={(e) => setCapacityForm((f) => ({ ...f, maxConcurrentOnLeave: e.target.value }))} required />
          <input type="date" className="input" value={capacityForm.effectiveFrom} onChange={(e) => setCapacityForm((f) => ({ ...f, effectiveFrom: e.target.value }))} required />
          <PrimaryButton type="submit" disabled={savingCapacity} className="w-full">{savingCapacity ? 'Saving…' : 'Set limit'}</PrimaryButton>
        </form>
        <div className="space-y-1">
          {!limits.length ? (
            <p className="small muted text-center py-4">No team capacity limits configured yet.</p>
          ) : limits.map((l) => {
            const disabled = l.effective_to && l.effective_to <= new Date().toISOString().slice(0, 10);
            return (
              <button
                type="button"
                key={l.capacity_limit_id}
                onClick={() => setEditingLimit(l)}
                className="w-full flex items-center justify-between small rounded-md px-3 py-2 text-left hover:bg-tint-2 transition-colors"
              >
                <div>
                  <p className="flex items-center gap-2">
                    {l.managerEmployee?.full_name || `Manager #${l.manager_employee_id}`}
                    {disabled && <span className="pill pill--muted">Disabled</span>}
                  </p>
                  <p className="muted small">
                    Max {l.max_concurrent_on_leave} concurrent · from {l.effective_from}{l.effective_to ? ` to ${l.effective_to}` : ''}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </GlassCard>

      {editingPeriod && (
        <BlackoutEditModal
          period={editingPeriod}
          onClose={() => setEditingPeriod(null)}
          onSaved={() => { setEditingPeriod(null); load(); }}
        />
      )}
      {editingLimit && (
        <CapacityEditModal
          limit={editingLimit}
          onClose={() => setEditingLimit(null)}
          onSaved={() => { setEditingLimit(null); load(); }}
        />
      )}
    </div>
  );
}

function BlackoutEditModal({ period, onClose, onSaved }) {
  const [values, setValues] = useState({ name: period.name, startDate: period.start_date, endDate: period.end_date });
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const dateError = dateRangeError(values.startDate, values.endDate);

  const save = async () => {
    if (dateError) return;
    setSaving(true);
    try {
      await updateBlackoutPeriod(period.blackout_id, values);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    await setBlackoutPeriodActive(period.blackout_id, !period.is_active);
    onSaved();
  };

  const remove = async () => {
    await removeBlackoutPeriod(period.blackout_id);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Edit blackout period" maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="field">
          <label>Name</label>
          <input className="input" value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} />
        </div>
        <div className="grid2">
          <div className="field">
            <label>Start date</label>
            <input type="date" className="input" value={values.startDate} onChange={(e) => setValues((v) => ({ ...v, startDate: e.target.value }))} />
          </div>
          <div className="field">
            <label>End date</label>
            <input type="date" className="input" value={values.endDate} onChange={(e) => setValues((v) => ({ ...v, endDate: e.target.value }))} />
          </div>
        </div>
        {dateError && <p className="error-msg">{dateError}</p>}

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-border">
          <p className="small font-medium">{period.is_active ? 'Active' : 'Disabled'}</p>
          <button type="button" role="switch" aria-checked={period.is_active} aria-label="Active" onClick={toggleActive} className="switch" />
        </div>

        {!confirmingDelete ? (
          <div className="flex items-center gap-2">
            <PrimaryButton onClick={save} disabled={saving || !!dateError} className="flex-1">{saving ? 'Saving…' : 'Save changes'}</PrimaryButton>
            <GhostButton type="button" onClick={() => setConfirmingDelete(true)}>
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </GhostButton>
          </div>
        ) : (
          <div className="alert alert--danger">
            <p className="small">Delete this blackout period?</p>
            <div className="actions">
              <GhostButton type="button" onClick={() => setConfirmingDelete(false)}>Cancel</GhostButton>
              <DangerButton type="button" onClick={remove}>Confirm</DangerButton>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CapacityEditModal({ limit, onClose, onSaved }) {
  const [values, setValues] = useState({ maxConcurrentOnLeave: limit.max_concurrent_on_leave, effectiveFrom: limit.effective_from });
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isActive = !(limit.effective_to && limit.effective_to <= new Date().toISOString().slice(0, 10));

  const save = async () => {
    setSaving(true);
    try {
      await updateTeamCapacityLimit(limit.capacity_limit_id, values);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    await setTeamCapacityLimitActive(limit.capacity_limit_id, !isActive);
    onSaved();
  };

  const remove = async () => {
    await removeTeamCapacityLimit(limit.capacity_limit_id);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={limit.managerEmployee?.full_name || 'Edit team capacity limit'} maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="field">
          <label>Max concurrent on leave</label>
          <input type="number" min="1" className="input" value={values.maxConcurrentOnLeave}
            onChange={(e) => setValues((v) => ({ ...v, maxConcurrentOnLeave: e.target.value }))} />
        </div>
        <div className="field">
          <label>Effective from</label>
          <input type="date" className="input" value={values.effectiveFrom}
            onChange={(e) => setValues((v) => ({ ...v, effectiveFrom: e.target.value }))} />
        </div>

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-border">
          <p className="small font-medium">{isActive ? 'Active' : 'Disabled'}</p>
          <button type="button" role="switch" aria-checked={isActive} aria-label="Active" onClick={toggleActive} className="switch" />
        </div>

        {!confirmingDelete ? (
          <div className="flex items-center gap-2">
            <PrimaryButton onClick={save} disabled={saving} className="flex-1">{saving ? 'Saving…' : 'Save changes'}</PrimaryButton>
            <GhostButton type="button" onClick={() => setConfirmingDelete(true)}>
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </GhostButton>
          </div>
        ) : (
          <div className="alert alert--danger">
            <p className="small">Delete this capacity limit?</p>
            <div className="actions">
              <GhostButton type="button" onClick={() => setConfirmingDelete(false)}>Cancel</GhostButton>
              <DangerButton type="button" onClick={remove}>Confirm</DangerButton>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
