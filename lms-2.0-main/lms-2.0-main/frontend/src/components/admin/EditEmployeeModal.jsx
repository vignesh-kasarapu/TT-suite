import { useEffect, useState } from 'react';
import Modal from '../common/Modal';
import { PrimaryButton, GhostButton } from '../common/GlassButton';
import { getEmployeeLeaveTypes, reassignManager, updateEmployeeDetails } from '../../api/employees';
import { createDepartment, createRegion, renameDepartment, renameRegion } from '../../api/admin';
import MasterPicker from './MasterPicker';
import { normaliseMarital } from '../../utils/maritalStatus';

export default function EditEmployeeModal({
  employee, allEmployees = [], managementLevels, departments = [], regions, onListsChanged, onClose, onSaved,
}) {
  // Reads the flat `roles` array the API actually returns. This used to look for a nested
  // `Roles` array of objects that no endpoint produced, so the management-level field was
  // unreachable for everyone, including managers.
  // Management level is a manager/HR field — an ordinary employee has none.
  const isManagerial = (employee.roles || []).some((r) => r === 'MANAGER' || r === 'HR_ADMIN');
  const [form, setForm] = useState({
    departmentId: employee.department_id ? String(employee.department_id) : '',
    managementLevelId: employee.management_level_id || '',
    regionId: employee.region_id ? String(employee.region_id) : '',
  });
  // Reporting manager: any active manager or HR admin other than this person. Changed through
  // the same reassignment as the row's "Reassign manager" (circular chains refused, everyone told).
  const currentManagerId = employee.reporting_manager_id ? String(employee.reporting_manager_id) : '';
  const [managerId, setManagerId] = useState(currentManagerId);
  const [transferPending, setTransferPending] = useState(false);
  const managerChoices = allEmployees.filter((e) => e.employee_id !== employee.employee_id
    && (String(e.employee_id) === currentManagerId
      || (e.status === 'ACTIVE' && (e.roles || []).some((r) => r === 'MANAGER' || r === 'HR_ADMIN'))));
  // Every leave type an employee can apply for, with whether it applies to this person.
  const [leaveTypes, setLeaveTypes] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getEmployeeLeaveTypes(employee.employee_id)
      .then((res) => setLeaveTypes(res.data))
      .catch((err) => setError(err.message));
  }, [employee.employee_id]);

  const departmentItems = departments.map((d) => ({ id: d.department_id, name: d.department_name }));
  const regionItems = regions.map((r) => ({ id: r.region_id, name: r.region_name }));

  const saved = async (request) => {
    const { data } = await request;
    await onListsChanged?.();
    return data;
  };
  const addDepartment = async (name) => {
    const d = await saved(createDepartment({ departmentName: name }));
    return { id: d.department_id, name: d.department_name };
  };
  const editDepartment = async (id, name) => {
    const d = await saved(renameDepartment(id, name));
    return { id: d.department_id, name: d.department_name };
  };
  const addRegion = async (name) => {
    const r = await saved(createRegion({ regionName: name }));
    return { id: r.region_id, name: r.region_name };
  };
  const editRegion = async (id, name) => {
    const r = await saved(renameRegion(id, name));
    return { id: r.region_id, name: r.region_name };
  };

  const toggleLeaveType = (leaveTypeId) => setLeaveTypes((types) => types.map((t) => (
    t.leave_type_id === leaveTypeId ? { ...t, applicable: !t.applicable } : t)));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // The field is not shown for an ordinary employee, so it is not sent — otherwise a
      // stale value would be written back by a save that never offered it.
      const { managementLevelId, departmentId, ...rest } = form;
      const department = departments.find((d) => String(d.department_id) === departmentId);
      const payload = { ...rest, departmentName: department?.department_name || '' };
      if (isManagerial) payload.managementLevelId = managementLevelId;
      if (leaveTypes) payload.applicableLeaveTypeIds = leaveTypes.filter((t) => t.applicable).map((t) => t.leave_type_id);
      await updateEmployeeDetails(employee.employee_id, payload);
      if (managerId && managerId !== currentManagerId) {
        await reassignManager(employee.employee_id, Number(managerId), transferPending);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Edit ${employee.full_name}`}>
      <form onSubmit={submit} className="space-y-3">
        {/* Name and work email are the person's TT Suite identity: read-only here, managed
            by the global admin in the portal. */}
        <div className="field">
          <label>Name and work email</label>
          <p className="small">{employee.full_name} · <span className="muted">{employee.work_email}</span></p>
          <p className="hint">Managed by the global admin in the TT Suite portal.</p>
        </div>
        {/* The employee code is the suite person's company code: LMS uses it as its own and
            HR cannot change it here (the API refuses it). */}
        <div className="field">
          <label htmlFor="edit-employee-code">Employee code</label>
          <input id="edit-employee-code" className="input num" value={employee.employee_code || ''}
            readOnly disabled data-testid="employee-code-readonly" />
          <p className="hint">Set by the global admin in the TT Suite.</p>
        </div>
        <div className="field">
          <label htmlFor="edit-designation">Designation</label>
          <input id="edit-designation" className="input" value={employee.designation || ''} readOnly disabled />
          <p className="hint">Part of the person's TT Suite profile, like their gender and marital status.</p>
        </div>
        <div className="field">
          <label htmlFor="edit-manager">Reporting manager</label>
          <select id="edit-manager" className="input" value={managerId} data-testid="edit-manager"
            onChange={(e) => setManagerId(e.target.value)}>
            {!currentManagerId && <option value="">Not assigned</option>}
            {managerChoices.map((m) => (
              <option key={m.employee_id} value={m.employee_id}>
                {m.full_name}{m.employee_code ? ` (${m.employee_code})` : ''}
              </option>
            ))}
          </select>
          {managerId !== currentManagerId && currentManagerId && (
            <label className="chk muted small">
              <input type="checkbox" checked={transferPending} onChange={(e) => setTransferPending(e.target.checked)} />
              Move pending requests to the new manager too
            </label>
          )}
        </div>
        <MasterPicker id="edit-department" label="Department" items={departmentItems} value={form.departmentId}
          emptyLabel="Select a department" required
          onChange={(departmentId) => setForm((f) => ({ ...f, departmentId }))}
          onCreate={addDepartment} onRename={editDepartment} />
        {isManagerial && (
          <div className="field">
            <label>Management level</label>
            <select className="input" value={form.managementLevelId}
              onChange={(e) => setForm((f) => ({ ...f, managementLevelId: e.target.value }))}>
              <option value="">No management level</option>
              {managementLevels.map((level) => (
                <option key={level.management_level_id} value={level.management_level_id}>
                  {level.level_code} — {level.level_name}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* Gender decides who may apply for a gender-restricted leave type (Maternity), so
            it is read here and changed in the suite — where it also reaches every other app. */}
        <div className="grid2">
          <div className="field">
            <label htmlFor="edit-gender">Gender</label>
            <input id="edit-gender" className="input" value={employee.gender || 'Not set'} readOnly disabled />
          </div>
          <div className="field">
            <label htmlFor="edit-marital">Marital status</label>
            <input id="edit-marital" className="input" data-testid="edit-marital"
              value={normaliseMarital(employee.marital_status) || 'Not set'} readOnly disabled />
          </div>
        </div>
        <p className="hint">
          Designation, gender and marital status come from the TT Suite profile. A global admin
          changes them in Users &amp; access and every app follows.
        </p>
        <MasterPicker id="edit-region" label="Region of working" items={regionItems} value={form.regionId}
          emptyLabel="No region"
          onChange={(regionId) => setForm((f) => ({ ...f, regionId }))}
          onCreate={addRegion} onRename={editRegion} />

        <fieldset className="field" data-testid="applicable-leave-types">
          <legend>Applicable leave types</legend>
          <p className="hint">Only ticked types show on this person's dashboard and can be applied for.</p>
          {leaveTypes === null ? (
            <p className="small muted">Loading…</p>
          ) : leaveTypes.length === 0 ? (
            <p className="small muted">No leave types yet.</p>
          ) : (
            <div className="grid2">
              {leaveTypes.map((t) => (
                <label key={t.leave_type_id} className="chk">
                  <input type="checkbox" checked={t.applicable} onChange={() => toggleLeaveType(t.leave_type_id)}
                    data-testid={`leave-type-${t.type_code}`} />
                  {t.type_name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        {error && <p className="error-msg">{error}</p>}
        <div className="flex gap-2 pt-1">
          <GhostButton type="button" onClick={onClose} className="flex-1 justify-center">Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={saving} className="flex-1">{saving ? 'Saving…' : 'Save changes'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
