import { useState } from 'react';
import Modal from '../common/Modal';
import { PrimaryButton, GhostButton } from '../common/GlassButton';
import { updateEmployeeDetails } from '../../api/employees';

export default function EditEmployeeModal({ employee, managementLevels, regions, grades = [], onClose, onSaved }) {
  // Reads the flat `roles` array the API actually returns. This used to look for a nested
  // `Roles` array of objects that no endpoint produced, so the management-level field was
  // unreachable for everyone, including managers.
  // Management level and grade are both manager/HR fields — an ordinary employee has
  // neither, so the two render together off the same role check.
  const isManagerial = (employee.roles || []).some((r) => r === 'MANAGER' || r === 'HR_ADMIN');
  const [form, setForm] = useState({
    fullName: employee.full_name || '',
    workEmail: employee.work_email || '',
    designation: employee.designation || '',
    departmentName: employee.Department?.department_name || '',
    managementLevelId: employee.management_level_id || '',
    gender: employee.gender || '',
    maritalStatus: employee.marital_status || '',
    regionId: employee.region_id || '',
    gradeId: employee.grade_id || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Neither field is shown for an ordinary employee, so neither is sent — otherwise a
      // stale value would be written back by a save that never offered it.
      const { gradeId, managementLevelId, ...rest } = form;
      await updateEmployeeDetails(employee.employee_id, isManagerial ? form : rest);
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
        <div className="field">
          <label>Full name</label>
          <input className="input" value={form.fullName}
            onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} required />
        </div>
        <div className="field">
          <label>Work email</label>
          <input className="input" type="email" value={form.workEmail}
            onChange={(e) => setForm((f) => ({ ...f, workEmail: e.target.value }))} required />
          <p className="hint">Used to sign in. Changing it changes which Microsoft account this record matches.</p>
        </div>
        <div className="field">
          <label>Designation</label>
          <input className="input" value={form.designation}
            onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} required />
        </div>
        <div className="field">
          <label>Department</label>
          <input className="input" value={form.departmentName}
            onChange={(e) => setForm((f) => ({ ...f, departmentName: e.target.value }))} required />
        </div>
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
        <div className="grid2">
          <div className="field">
            <label>Gender</label>
            <select className="input" value={form.gender}
              onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}>
              <option value="">Prefer not to say</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
            </select>
          </div>
          <div className="field">
            <label>Marital status</label>
            <input className="input" placeholder="e.g. Single, Married" value={form.maritalStatus}
              onChange={(e) => setForm((f) => ({ ...f, maritalStatus: e.target.value }))} />
          </div>
        </div>
        {isManagerial && (
          <div className="field">
            <label>Grade</label>
            <select className="input" value={form.gradeId}
              onChange={(e) => setForm((f) => ({ ...f, gradeId: e.target.value }))}>
              <option value="">No grade</option>
              {grades.map((g) => (
                <option key={g.grade_id} value={g.grade_id}>{g.grade_code} — {g.grade_name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label>Region of working</label>
          <select className="input" value={form.regionId}
            onChange={(e) => setForm((f) => ({ ...f, regionId: e.target.value }))}>
            <option value="">No region</option>
            {regions.map((r) => <option key={r.region_id} value={r.region_id}>{r.region_name}</option>)}
          </select>
        </div>

        {error && <p className="error-msg">{error}</p>}
        <div className="flex gap-2 pt-1">
          <GhostButton type="button" onClick={onClose} className="flex-1 justify-center">Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={saving} className="flex-1">{saving ? 'Saving…' : 'Save changes'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
