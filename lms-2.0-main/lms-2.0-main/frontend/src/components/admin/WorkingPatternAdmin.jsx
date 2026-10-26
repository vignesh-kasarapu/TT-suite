import { useEffect, useState } from 'react';
import { CalendarRange, Trash2, Users } from 'lucide-react';
import {
  listWorkingPatterns, createWorkingPattern, deactivateWorkingPattern, reactivateWorkingPattern, assignWorkingPattern,
  listWorkingPatternAssignments, updateWorkingPatternAssignment,
} from '../../api/admin';
import { listEmployees } from '../../api/employees';
import GlassCard from '../common/GlassCard';
import Modal from '../common/Modal';
import EmptyState from '../common/EmptyState';
import { PrimaryButton, GhostButton, DangerButton } from '../common/GlassButton';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

// Shared by the assign form and AssignmentEditModal — the backend's assertNoOverlap
// implicitly rejects an inverted range too, but this gives fast client-side feedback
// instead of a raw backend rejection round-trip.
function effectiveRangeError(effectiveFrom, effectiveTo) {
  return effectiveFrom && effectiveTo && effectiveTo < effectiveFrom ? 'End date cannot be before start date.' : null;
}

function assignmentStatus(a) {
  const today = new Date().toISOString().slice(0, 10);
  if (a.effective_from > today) return { label: 'Upcoming', pill: 'pill--accent' };
  if (a.effective_to && a.effective_to < today) return { label: 'Ended', pill: 'pill--muted' };
  return { label: 'Active', pill: 'pill--success' };
}

export default function WorkingPatternAdmin() {
  const [patterns, setPatterns] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [patternForm, setPatternForm] = useState({ patternCode: '', patternName: '', weekendDays: [] });
  const [assignForm, setAssignForm] = useState({ employeeId: '', workingPatternId: '', effectiveFrom: '', effectiveTo: '' });
  const [savingPattern, setSavingPattern] = useState(false);
  const [savingAssign, setSavingAssign] = useState(false);
  const [assignError, setAssignError] = useState(null);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [reactivatingId, setReactivatingId] = useState(null);

  const loadPatterns = (includeInactive = showInactive) =>
    listWorkingPatterns(includeInactive).then((res) => setPatterns(res.data));

  const load = () => {
    loadPatterns();
    listEmployees().then((res) => setEmployees(res.data));
    listWorkingPatternAssignments().then((res) => setAssignments(res.data));
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { loadPatterns(); }, [showInactive]); // eslint-disable-line react-hooks/exhaustive-deps

  const deletePattern = async (patternId) => {
    setDeleteError(null);
    setDeletingId(patternId);
    try {
      await deactivateWorkingPattern(patternId);
      loadPatterns();
    } catch (err) {
      setDeleteError(err.message); // e.g. "assigned to N employee(s)" refusal
    } finally {
      setDeletingId(null);
    }
  };

  const reactivatePattern = async (patternId) => {
    setReactivatingId(patternId);
    try {
      await reactivateWorkingPattern(patternId);
      loadPatterns();
    } finally {
      setReactivatingId(null);
    }
  };

  const toggleDay = (day) => {
    setPatternForm((f) => ({
      ...f,
      weekendDays: f.weekendDays.includes(day) ? f.weekendDays.filter((d) => d !== day) : [...f.weekendDays, day],
    }));
  };

  const submitPattern = async (e) => {
    e.preventDefault();
    setSavingPattern(true);
    try {
      await createWorkingPattern(patternForm);
      setPatternForm({ patternCode: '', patternName: '', weekendDays: [] });
      load();
    } finally {
      setSavingPattern(false);
    }
  };

  const assignRangeError = effectiveRangeError(assignForm.effectiveFrom, assignForm.effectiveTo);

  const submitAssign = async (e) => {
    e.preventDefault();
    if (assignRangeError) return;
    setSavingAssign(true);
    setAssignError(null);
    try {
      await assignWorkingPattern(assignForm);
      setAssignForm({ employeeId: '', workingPatternId: '', effectiveFrom: '', effectiveTo: '' });
      listWorkingPatternAssignments().then((res) => setAssignments(res.data));
    } catch (err) {
      setAssignError(err.message); // e.g. overlap refusal (LMS-015)
    } finally {
      setSavingAssign(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <GlassCard className="lg:col-span-2">
        <h3 className="h3 mb-1 flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-accent-text" /> Working patterns
        </h3>
        <p className="small muted mb-4">For round-the-clock coverage teams whose weekend differs from the org default.</p>

        <form onSubmit={submitPattern} className="space-y-3 pb-4 mb-4 border-b border-border">
          <div className="field">
            <label>Pattern code</label>
            <input className="input" placeholder="e.g. FRI_SAT" value={patternForm.patternCode}
              onChange={(e) => setPatternForm((f) => ({ ...f, patternCode: e.target.value.toUpperCase() }))} required />
          </div>
          <div className="field">
            <label>Pattern name</label>
            <input className="input" placeholder="Pattern name" value={patternForm.patternName}
              onChange={(e) => setPatternForm((f) => ({ ...f, patternName: e.target.value }))} required />
          </div>
          <div className="field">
            <label>Weekend days</label>
            <div className="choices">
              {WEEKDAYS.map((day) => (
                <button type="button" key={day} onClick={() => toggleDay(day)}
                  className={`pill ${patternForm.weekendDays.includes(day) ? 'pill--accent' : 'pill--muted'}`}>
                  {day}
                </button>
              ))}
            </div>
          </div>
          <PrimaryButton type="submit" disabled={savingPattern || !patternForm.weekendDays.length} className="w-full">
            {savingPattern ? 'Saving…' : 'Create pattern'}
          </PrimaryButton>
        </form>

        {deleteError && <p className="error-msg mb-2">{deleteError}</p>}
        <label className="chk small mb-2">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show deactivated patterns
        </label>
        {!patterns.length ? (
          <EmptyState icon={CalendarRange} title="No working patterns yet" />
        ) : (
          <div className="space-y-2">
            {patterns.map((p) => (
              <div key={p.working_pattern_id} className="text-sm rounded-md px-3 py-2 flex items-center justify-between gap-2" style={{ background: 'var(--color-tint-2)' }}>
                <div>
                  <p className="flex items-center gap-2 flex-wrap">
                    {p.pattern_name}
                    {!p.is_active && <span className="pill pill--danger">Disabled</span>}
                  </p>
                  <p className="small muted">Weekend: {JSON.parse(p.weekend_days).join(', ')}</p>
                </div>
                {!p.is_active ? (
                  <button
                    type="button"
                    onClick={() => reactivatePattern(p.working_pattern_id)}
                    disabled={reactivatingId === p.working_pattern_id}
                    className="small font-medium shrink-0 disabled:opacity-50 text-success"
                  >
                    {reactivatingId === p.working_pattern_id ? 'Reactivating…' : 'Reactivate'}
                  </button>
                ) : confirmDeleteId === p.working_pattern_id ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <p className="small font-medium" style={{ color: 'var(--color-danger-text)' }}>Delete?</p>
                    <GhostButton type="button" onClick={() => setConfirmDeleteId(null)} className="btn--sm">Cancel</GhostButton>
                    <DangerButton
                      type="button"
                      onClick={() => { setConfirmDeleteId(null); deletePattern(p.working_pattern_id); }}
                      disabled={deletingId === p.working_pattern_id}
                      className="btn--sm"
                    >
                      Confirm
                    </DangerButton>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(p.working_pattern_id)}
                    disabled={deletingId === p.working_pattern_id}
                    className="muted shrink-0 disabled:opacity-50"
                    aria-label="Delete pattern"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      <GlassCard className="lg:col-span-3">
        <h3 className="h3 mb-4">Assign to employee</h3>
        <form onSubmit={submitAssign} className="grid2">
          <select className="input" value={assignForm.employeeId} onChange={(e) => setAssignForm((f) => ({ ...f, employeeId: e.target.value }))} required>
            <option value="">Employee…</option>
            {employees.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.full_name}</option>)}
          </select>
          <select className="input" value={assignForm.workingPatternId} onChange={(e) => setAssignForm((f) => ({ ...f, workingPatternId: e.target.value }))} required>
            <option value="">Pattern…</option>
            {patterns.filter((p) => p.is_active).map((p) => <option key={p.working_pattern_id} value={p.working_pattern_id}>{p.pattern_name}</option>)}
          </select>
          <input type="date" className="input" value={assignForm.effectiveFrom} onChange={(e) => setAssignForm((f) => ({ ...f, effectiveFrom: e.target.value }))} required />
          <input type="date" className="input" placeholder="Open-ended" value={assignForm.effectiveTo} onChange={(e) => setAssignForm((f) => ({ ...f, effectiveTo: e.target.value }))} />
          {assignRangeError && <p className="sm:col-span-2 error-msg">{assignRangeError}</p>}
          {assignError && <p className="sm:col-span-2 error-msg">{assignError}</p>}
          <PrimaryButton type="submit" disabled={savingAssign || !!assignRangeError} className="sm:col-span-2">
            {savingAssign ? 'Saving…' : 'Assign pattern'}
          </PrimaryButton>
        </form>
        <p className="small muted mt-3">Exactly one pattern can be active per employee on any given date — overlapping assignments are refused.</p>

        <div className="mt-5 pt-4 border-t border-border">
          <h4 className="small font-medium muted mb-3 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> Assigned employees
          </h4>
          {!assignments.length ? (
            <EmptyState icon={Users} title="No working pattern assignments yet" />
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {assignments.map((a) => {
                const status = assignmentStatus(a);
                return (
                  <button
                    type="button"
                    key={a.assignment_id}
                    onClick={() => setEditingAssignment(a)}
                    className="w-full flex items-center justify-between gap-3 text-sm rounded-md px-3 py-2 text-left"
                    style={{ background: 'var(--color-tint-2)' }}
                    title="Click to edit this assignment"
                  >
                    <div className="min-w-0">
                      <p className="truncate">
                        {a.Employee?.first_name ? `${a.Employee.first_name} ${a.Employee.last_name || ''}`.trim() : a.Employee?.employee_code}
                        <span className="muted"> — {a.WorkingPattern?.pattern_name}</span>
                      </p>
                      <p className="small muted">{a.effective_from} → {a.effective_to || 'Open-ended'}</p>
                    </div>
                    <span className={`pill shrink-0 ${status.pill}`}>{status.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </GlassCard>

      {editingAssignment && (
        <AssignmentEditModal
          assignment={editingAssignment}
          patterns={patterns}
          onClose={() => setEditingAssignment(null)}
          onSaved={() => { setEditingAssignment(null); listWorkingPatternAssignments().then((res) => setAssignments(res.data)); }}
        />
      )}
    </div>
  );
}

function AssignmentEditModal({ assignment, patterns, onClose, onSaved }) {
  const employeeName = assignment.Employee?.first_name
    ? `${assignment.Employee.first_name} ${assignment.Employee.last_name || ''}`.trim()
    : assignment.Employee?.employee_code;

  const [form, setForm] = useState({
    workingPatternId: assignment.working_pattern_id,
    effectiveFrom: assignment.effective_from,
    effectiveTo: assignment.effective_to || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const rangeError = effectiveRangeError(form.effectiveFrom, form.effectiveTo);

  const submit = async (e) => {
    e.preventDefault();
    if (rangeError) return;
    setSaving(true);
    setError(null);
    try {
      await updateWorkingPatternAssignment(assignment.assignment_id, form);
      onSaved();
    } catch (err) {
      setError(err.message); // e.g. overlap refusal (LMS-015)
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Edit assignment — ${employeeName}`} maxWidth="max-w-md">
      <form onSubmit={submit} className="space-y-3">
        <div className="field">
          <label>Pattern</label>
          <select className="input" value={form.workingPatternId}
            onChange={(e) => setForm((f) => ({ ...f, workingPatternId: e.target.value }))} required>
            {patterns.filter((p) => p.is_active).map((p) => <option key={p.working_pattern_id} value={p.working_pattern_id}>{p.pattern_name}</option>)}
          </select>
        </div>
        <div className="grid2">
          <div className="field">
            <label>Effective from</label>
            <input type="date" className="input" value={form.effectiveFrom}
              onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))} required />
          </div>
          <div className="field">
            <label>Effective to</label>
            <input type="date" className="input" placeholder="Open-ended" value={form.effectiveTo}
              onChange={(e) => setForm((f) => ({ ...f, effectiveTo: e.target.value }))} />
          </div>
        </div>
        {rangeError && <p className="error-msg">{rangeError}</p>}
        {error && <p className="error-msg">{error}</p>}
        <div className="flex gap-2 pt-1">
          <GhostButton type="button" onClick={onClose} className="flex-1 justify-center">Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={saving || !!rangeError} className="flex-1">{saving ? 'Saving…' : 'Save changes'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
