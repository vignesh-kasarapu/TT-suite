import { useEffect, useState } from 'react';
import { CalendarPlus, Pencil, TriangleAlert, Trash2, Users } from 'lucide-react';
import { listHolidays, addHoliday, updateHoliday, removeHoliday, getOptionalHolidayUsage } from '../../api/admin';
import { listRegions } from '../../api/admin';
import GlassCard from '../common/GlassCard';
import Table from '../common/Table';
import EmptyState from '../common/EmptyState';
import HolidayCard from '../common/HolidayCard';
import { PrimaryButton, GhostButton, DangerButton } from '../common/GlassButton';

const USAGE_COLUMNS = [{ label: 'Employee' }, { label: 'Taken' }, { label: 'Remaining' }];
const EMPTY_FORM = { date: '', name: '', regionId: '', isOptional: false };

export default function HolidayAdmin({ leaveYearId }) {
  const [holidays, setHolidays] = useState([]);
  const [regions, setRegions] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  // The holiday being edited (the form above then saves it instead of adding a new one).
  const [editingId, setEditingId] = useState(null);
  const [warning, setWarning] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [usage, setUsage] = useState({ quota: 0, employees: [] });

  const load = () => leaveYearId && listHolidays(leaveYearId).then((res) => setHolidays(res.data));
  // The API returns only region_id; the name comes from the regions list.
  const regionName = (regionId) => (regionId == null
    ? 'All regions'
    : regions.find((r) => r.region_id === regionId)?.region_name || `Region #${regionId}`);
  const loadUsage = () => leaveYearId && getOptionalHolidayUsage(leaveYearId).then((res) => setUsage(res.data));
  useEffect(() => { load(); loadUsage(); }, [leaveYearId]);
  useEffect(() => { listRegions().then((res) => setRegions(res.data)); }, []);

  const startEdit = (h) => {
    setEditingId(h.holiday_id);
    setConfirmDeleteId(null);
    setWarning(null);
    setError(null);
    setForm({ date: h.holiday_date, name: h.holiday_name, regionId: h.region_id ?? '', isOptional: h.is_optional });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setWarning(null);
    setError(null);
    try {
      // The API's field names (holiday_date, holiday_name...); "All regions" is no region.
      const fields = {
        holidayDate: form.date, holidayName: form.name.trim(), regionId: form.regionId || null, isOptional: form.isOptional,
      };
      const res = editingId ? await updateHoliday(editingId, fields) : await addHoliday({ ...fields, leaveYearId });
      const notes = [];
      if (res.data.affectedRequestIds?.length) {
        notes.push(`This date falls inside ${res.data.affectedRequestIds.length} already-approved leave request(s) — their deduction was computed under the prior calendar.`);
      }
      if (res.data.removedSelections) {
        notes.push(`It is now a holiday for everyone, so ${res.data.removedSelections} employee(s) who had picked it got that optional holiday back.`);
      }
      if (notes.length) setWarning(notes.join(' '));
      setEditingId(null);
      setForm(EMPTY_FORM);
      load();
      loadUsage();
    } catch (err) {
      setError(err.message || (editingId ? 'The holiday could not be saved.' : 'The holiday could not be added.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <GlassCard className="lg:col-span-2">
        <h3 className="h3 mb-4 flex items-center gap-2">
          {editingId ? <Pencil className="w-4 h-4 text-accent-text" /> : <CalendarPlus className="w-4 h-4 text-accent-text" />}
          {editingId ? 'Edit holiday' : 'Add holiday'}
        </h3>
        <form onSubmit={submit} className="space-y-3">
          <div className="field">
            <label>Date</label>
            <input type="date" className="input" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required />
          </div>
          <div className="field">
            <label>Holiday name</label>
            <input className="input" placeholder="Holiday name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="field">
            <label>Region</label>
            <select className="input" value={form.regionId}
              onChange={(e) => setForm((f) => ({ ...f, regionId: e.target.value }))}>
              <option value="">All regions (org-wide)</option>
              {regions.map((r) => <option key={r.region_id} value={r.region_id}>{r.region_name}</option>)}
            </select>
            <p className="hint">
              {form.regionId
                ? 'Only people whose region of working is this region see it (set in Employees > Edit). People with no region do not.'
                : 'Everyone sees it.'}
            </p>
          </div>
          <label className="chk small">
            <input type="checkbox" checked={form.isOptional} onChange={(e) => setForm((f) => ({ ...f, isOptional: e.target.checked }))} />
            Optional holiday (employees choose it, up to the number set in Settings) — otherwise a holiday for everyone
          </label>
          {warning && (
            <div className="alert alert--warning" role="status">
              <TriangleAlert /> <p>{warning}</p>
            </div>
          )}
          {error && <p className="error-msg" role="alert">{error}</p>}
          <PrimaryButton type="submit" disabled={saving || !leaveYearId} className="w-full">
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add holiday'}
          </PrimaryButton>
          {editingId && <GhostButton type="button" onClick={cancelEdit} className="w-full">Cancel editing</GhostButton>}
        </form>
      </GlassCard>

      <GlassCard className="lg:col-span-3">
        <h3 className="h3 mb-4">Current & next leave year</h3>
        {!holidays.length ? (
          <EmptyState icon={CalendarPlus} title="No holidays yet" description="Add a holiday to start building the calendar." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {holidays.map((h) => (
              <HolidayCard
                key={h.holiday_id}
                holiday={h}
                extraPills={<span className="pill pill--muted">{regionName(h.region_id)}</span>}
                action={confirmDeleteId === h.holiday_id ? null : (
                  <span className="flex items-center gap-3">
                    <button type="button" onClick={() => startEdit(h)} className="muted inline-grid place-items-center min-w-[40px] min-h-[40px] -m-2 sm:min-w-0 sm:min-h-0 sm:m-0" aria-label={`Edit ${h.holiday_name}`}>
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => setConfirmDeleteId(h.holiday_id)} className="muted inline-grid place-items-center min-w-[40px] min-h-[40px] -m-2 sm:min-w-0 sm:min-h-0 sm:m-0" aria-label="Delete holiday">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </span>
                )}
              >
                {confirmDeleteId === h.holiday_id && (
                  <div className="flex items-center gap-1.5">
                    <p className="small font-medium flex-1" style={{ color: 'var(--color-danger-text)' }}>Delete this holiday?</p>
                    <GhostButton type="button" onClick={() => setConfirmDeleteId(null)} className="btn--sm">Cancel</GhostButton>
                    <DangerButton
                      type="button"
                      onClick={() => {
                        removeHoliday(h.holiday_id).then(() => { load(); loadUsage(); });
                        setConfirmDeleteId(null);
                        if (editingId === h.holiday_id) cancelEdit();
                      }}
                      className="btn--sm"
                    >
                      Confirm
                    </DangerButton>
                  </div>
                )}
              </HolidayCard>
            ))}
          </div>
        )}
      </GlassCard>

      <GlassCard className="lg:col-span-5">
        <h3 className="h3 mb-1 flex items-center gap-2">
          <Users className="w-4 h-4 text-accent-text" /> Optional holiday usage
        </h3>
        <p className="small muted mb-4">
          Each employee can take <strong className="text-text">{usage.quota}</strong> optional holiday(s) this leave year
          {' '}— change the number in Settings (Optional holidays each employee can take).
        </p>
        {!usage.employees.length ? (
          <EmptyState icon={Users} title="No employees to show" />
        ) : (
          <Table columns={USAGE_COLUMNS} maxHeight="max-h-[40vh]">
            {usage.employees.map((e) => (
              <tr key={e.employeeId}>
                <td className="px-4 py-2.5 text-sm whitespace-nowrap">{e.fullName}</td>
                <td className="px-4 py-2.5 text-sm muted">{e.taken}</td>
                <td className={`px-4 py-2.5 text-sm font-medium ${e.remaining === 0 ? 'muted' : 'text-success'}`}>{e.remaining}</td>
              </tr>
            ))}
          </Table>
        )}
      </GlassCard>
    </div>
  );
}
