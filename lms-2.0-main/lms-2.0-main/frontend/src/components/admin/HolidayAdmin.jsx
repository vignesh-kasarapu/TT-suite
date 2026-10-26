import { useEffect, useState } from 'react';
import { CalendarPlus, TriangleAlert, Trash2, Users } from 'lucide-react';
import { listHolidays, addHoliday, removeHoliday, getOptionalHolidayUsage } from '../../api/admin';
import { listRegions } from '../../api/admin';
import GlassCard from '../common/GlassCard';
import Table from '../common/Table';
import EmptyState from '../common/EmptyState';
import { PrimaryButton, GhostButton, DangerButton } from '../common/GlassButton';

const USAGE_COLUMNS = [{ label: 'Employee' }, { label: 'Taken' }, { label: 'Remaining' }];

export default function HolidayAdmin({ leaveYearId }) {
  const [holidays, setHolidays] = useState([]);
  const [regions, setRegions] = useState([]);
  const [form, setForm] = useState({ date: '', name: '', regionId: '', isOptional: false });
  const [warning, setWarning] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [usage, setUsage] = useState({ quota: 0, employees: [] });

  const load = () => leaveYearId && listHolidays(leaveYearId).then((res) => setHolidays(res.data));
  const loadUsage = () => leaveYearId && getOptionalHolidayUsage(leaveYearId).then((res) => setUsage(res.data));
  useEffect(() => { load(); loadUsage(); }, [leaveYearId]);
  useEffect(() => { listRegions().then((res) => setRegions(res.data)); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setWarning(null);
    try {
      const res = await addHoliday({ ...form, leaveYearId });
      if (res.data.affectedRequestIds?.length) {
        setWarning(`This date falls inside ${res.data.affectedRequestIds.length} already-approved leave request(s) — their deduction was computed under the prior calendar.`);
      }
      setForm({ date: '', name: '', regionId: '', isOptional: false });
      load();
      loadUsage();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <GlassCard className="lg:col-span-2">
        <h3 className="h3 mb-4 flex items-center gap-2">
          <CalendarPlus className="w-4 h-4 text-accent-text" /> Add holiday
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
          </div>
          <label className="chk small">
            <input type="checkbox" checked={form.isOptional} onChange={(e) => setForm((f) => ({ ...f, isOptional: e.target.checked }))} />
            Optional holiday (employees opt in, up to their quota) — otherwise mandatory for everyone
          </label>
          {warning && (
            <div className="alert alert--warning" role="status">
              <TriangleAlert /> <p>{warning}</p>
            </div>
          )}
          <PrimaryButton type="submit" disabled={saving} className="w-full">{saving ? 'Saving…' : 'Add holiday'}</PrimaryButton>
        </form>
      </GlassCard>

      <GlassCard className="lg:col-span-3">
        <h3 className="h3 mb-4">Current & next leave year</h3>
        {!holidays.length ? (
          <EmptyState icon={CalendarPlus} title="No holidays yet" description="Add a holiday to start building the calendar." />
        ) : (
          <div className="divide-y divide-border">
            {holidays.map((h) => (
              <div key={h.holiday_id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm flex items-center gap-2 flex-wrap">
                    {h.holiday_name}
                    <span className="pill pill--muted">{h.Region ? h.Region.region_name : 'All regions'}</span>
                    {h.is_optional && <span className="pill pill--warning">Optional</span>}
                  </p>
                  <p className="small muted">{h.holiday_date}</p>
                </div>
                {confirmDeleteId === h.holiday_id ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <p className="small font-medium" style={{ color: 'var(--color-danger-text)' }}>Delete?</p>
                    <GhostButton type="button" onClick={() => setConfirmDeleteId(null)} className="btn--sm">Cancel</GhostButton>
                    <DangerButton
                      type="button"
                      onClick={() => { removeHoliday(h.holiday_id).then(load); setConfirmDeleteId(null); }}
                      className="btn--sm"
                    >
                      Confirm
                    </DangerButton>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDeleteId(h.holiday_id)} className="muted shrink-0" aria-label="Delete holiday">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      <GlassCard className="lg:col-span-5">
        <h3 className="h3 mb-1 flex items-center gap-2">
          <Users className="w-4 h-4 text-accent-text" /> Optional holiday usage
        </h3>
        <p className="small muted mb-4">
          Quota this leave year: <strong className="text-text">{usage.quota}</strong> per employee
          {' '}— auto-computed as half of published optional holidays, unless overridden in Settings.
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
