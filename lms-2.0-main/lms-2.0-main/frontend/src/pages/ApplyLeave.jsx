import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CalendarDays, Paperclip, FileText, PartyPopper, ListChecks } from 'lucide-react';
import { previewApplication, submitRequest, saveDraft, submitDraft, discardDraft, getMyRequests } from '../api/leaveRequests';
import { getDashboard } from '../api/employees';
import { listHolidays, getOptionalHolidaySummary } from '../api/holidays';
import { uploadAttachment } from '../api/attachments';
import { celebrate } from '../utils/celebrate';
import GlassCard from '../components/common/GlassCard';
import { PrimaryButton, GhostButton } from '../components/common/GlassButton';
import Topbar from '../components/layout/Topbar';

const LEAVE_TYPE_META = {
  ANNUAL: { icon: '🌴', desc: 'Paid vacation time' },
  SICK: { icon: '🩺', desc: 'Medical recovery & doctor visits' },
  CASUAL: { icon: '⚡', desc: 'Personal urgent matters' },
  MATERNITY: { icon: '🌸', desc: 'Time for childbirth and recovery' },
  BEREAVEMENT: { icon: '🕊️', desc: 'Time to grieve and support family' },
};

export default function ApplyLeave() {
  const navigate = useNavigate();
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [typesError, setTypesError] = useState(null);
  const [form, setForm] = useState({ leaveTypeId: '', startDate: '', endDate: '', isHalfDay: false, halfDayPortion: 'FIRST', reason: '' });
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const previewRequestId = useRef(0);

  const selectedType = leaveTypes.find((t) => String(t.id) === String(form.leaveTypeId));

  useEffect(() => {
    getDashboard().then((res) => {
      const dynamicTypes = (res.data.balances || []).map(({ leaveType }) => ({
        id: leaveType.leave_type_id,
        name: leaveType.type_name,
        icon: LEAVE_TYPE_META[leaveType.type_code]?.icon || '📝',
        halfDay: leaveType.permits_half_day,
        attachments: leaveType.permits_attachments,
        // The server resolves this against the signed-in employee, so a restricted type
        // (Maternity, for one) can be shown greyed out rather than accepting the form and
        // refusing it on submit. The same rule is enforced server-side regardless.
        eligible: leaveType.is_eligible !== false,
        desc: LEAVE_TYPE_META[leaveType.type_code]?.desc || 'Organisation leave entitlement',
      }));
      setLeaveTypes(dynamicTypes);
    }).catch(() => setTypesError('Could not load your leave types. Refresh the page to try again.'));
  }, []);

  // A merged, dated view of everything that already occupies an upcoming day — public
  // holidays, optional holidays this employee has opted into, and their own previously
  // applied leave requests — so a date can be sanity-checked here before picking one below,
  // instead of cross-referencing the separate Holiday Calendar and My Requests pages.
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const EXCLUDED_STATES = ['DRAFT', 'WITHDRAWN', 'CANCELLED', 'REJECTED'];

    Promise.all([listHolidays(), getMyRequests()])
      .then(async ([holidayRes, requestRes]) => {
        const holidays = holidayRes.data;
        const optionalYearIds = [...new Set(holidays.filter((h) => h.is_optional).map((h) => h.leave_year_id))];
        const summaries = await Promise.all(
          optionalYearIds.map((id) => getOptionalHolidaySummary(id).then((r) => r.data).catch(() => ({ eligibleHolidays: [] }))),
        );
        const selectedOptionalIds = new Set(
          summaries.flatMap((s) => s.eligibleHolidays.filter((h) => h.isSelected).map((h) => h.holiday_id)),
        );

        const holidayItems = holidays
          .filter((h) => h.holiday_date >= today && (!h.is_optional || selectedOptionalIds.has(h.holiday_id)))
          .map((h) => ({ date: h.holiday_date, label: h.holiday_name, type: h.is_optional ? 'OPTIONAL_HOLIDAY' : 'HOLIDAY' }));

        const leaveItems = requestRes.data
          .filter((r) => !EXCLUDED_STATES.includes(r.state) && r.end_date >= today)
          .map((r) => ({
            date: r.start_date,
            label: `${r.LeaveType?.type_name || 'Leave'} · ${r.state.replaceAll('_', ' ').toLowerCase()}`,
            type: 'MY_LEAVE',
          }));

        setUpcoming([...holidayItems, ...leaveItems].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8));
      })
      .catch(() => {}); // non-critical sidebar context — the form itself must still work if this fails
  }, []);

  useEffect(() => {
    if (!form.leaveTypeId || !form.startDate || !form.endDate) { setPreview(null); return; }
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      // Guards against an older, slower response overwriting a newer one when the form
      // changes again before the first request resolves — only the latest request's
      // result is ever applied.
      const requestId = ++previewRequestId.current;
      previewApplication({ ...form })
        // Clearing the error here is what stops a rejected preview outliving the edit that
        // fixed it: typing a date briefly produces an inverted range, and the resulting
        // "End date cannot be before start date." used to stay on screen even once both
        // dates were valid again, because nothing ever reset it.
        .then((res) => { if (requestId === previewRequestId.current) { setPreview(res.data); setError(null); } })
        .catch((err) => { if (requestId === previewRequestId.current) setError(err.message); })
        .finally(() => { if (requestId === previewRequestId.current) setPreviewLoading(false); });
    }, 300);
    return () => clearTimeout(timer);
  }, [form.leaveTypeId, form.startDate, form.endDate, form.isHalfDay]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (file && selectedType?.attachments) {
        // Draft -> upload -> submit, so the file is on the request before the
        // server's medical-certificate check runs (a sick request over the
        // configured length is refused without one).
        const draft = await saveDraft(form);
        const draftId = draft.data.request_id;
        try {
          await uploadAttachment(draftId, file);
          await submitDraft(draftId);
        } catch (err) {
          await discardDraft(draftId).catch(() => {});
          throw err;
        }
      } else {
        await submitRequest(form);
      }
      celebrate();
      navigate('/my-requests');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await saveDraft(form);
      navigate('/my-requests');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Topbar title="Apply for Leave" />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Main Application Form */}
        <GlassCard className="lg:col-span-3">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Leave type */}
            <div className="field">
              <label className="req">Leave type</label>
              {typesError && (
                <div className="alert alert--danger" role="alert">
                  <AlertTriangle />
                  <p>{typesError}</p>
                </div>
              )}
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                {leaveTypes.map((t) => {
                  const isSelected = String(form.leaveTypeId) === String(t.id);
                  return (
                    <button
                      type="button"
                      key={t.id}
                      disabled={!t.eligible}
                      aria-disabled={!t.eligible}
                      title={t.eligible ? undefined : `${t.name} is not available for your profile.`}
                      onClick={() => setForm((f) => ({ ...f, leaveTypeId: t.id }))}
                      className="p-space-3 rounded-md text-left border flex items-start gap-2"
                      style={{
                        borderColor: isSelected ? 'var(--color-accent)' : 'var(--color-border)',
                        background: isSelected ? 'var(--color-tint-2)' : 'var(--color-surface)',
                        opacity: t.eligible ? 1 : 0.45,
                        cursor: t.eligible ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <span className="text-lg shrink-0">{t.icon}</span>
                      <div className="min-w-0">
                        <p className="font-medium small truncate">{t.name}</p>
                        <p className="small muted mt-0.5 truncate">
                          {t.eligible ? t.desc : 'Not available for your profile'}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dates */}
            <div className="grid2">
              <div className="field">
                <label>Start date</label>
                <input type="date" className="input" value={form.startDate}
                  onChange={(e) => setForm((f) => (
                    // Moving the start past the end would leave an inverted range the server
                    // rejects, so the end follows it up rather than being left behind.
                    f.isHalfDay || (f.endDate && e.target.value > f.endDate)
                      ? { ...f, startDate: e.target.value, endDate: e.target.value }
                      : { ...f, startDate: e.target.value }
                  ))} required />
              </div>
              <div className="field">
                <label>End date</label>
                <input type="date" className="input disabled:opacity-60" value={form.endDate} min={form.startDate || undefined}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} disabled={form.isHalfDay} required />
              </div>
            </div>

            {/* Half Day Option */}
            {selectedType?.halfDay && (
              <div className="flex items-center justify-between gap-3 p-space-3 rounded-md bg-tint-2">
                <label className="chk">
                  <input type="checkbox" checked={form.isHalfDay}
                    onChange={(e) => setForm((f) => (
                      e.target.checked ? { ...f, isHalfDay: true, endDate: f.startDate } : { ...f, isHalfDay: false }
                    ))} />
                  Half-day leave duration
                </label>
                {form.isHalfDay && (
                  <select className="input" style={{ width: '9rem' }} value={form.halfDayPortion}
                    onChange={(e) => setForm((f) => ({ ...f, halfDayPortion: e.target.value }))}>
                    <option value="FIRST">First half (AM)</option>
                    <option value="SECOND">Second half (PM)</option>
                  </select>
                )}
              </div>
            )}

            {/* Reason */}
            <div className="field">
              <label>Reason for leave</label>
              <textarea
                className="input"
                placeholder="Provide details for your manager to review..."
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                required
              />
            </div>

            {/* Optional Attachment Dropzone */}
            {selectedType?.attachments && (
              <div className="field">
                <label className="flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5" /> Supporting document (medical certificate — required for long sick leave)
                </label>
                <label className="btn btn--secondary w-full justify-center cursor-pointer" style={{ borderStyle: 'dashed' }}>
                  <FileText className="w-4 h-4" />
                  <span className="small">{file ? file.name : 'Click to select PDF, PNG or JPEG (max 10MB)'}</span>
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </label>
              </div>
            )}

            {error && (
              <div className="alert alert--danger" role="alert">
                <AlertTriangle />
                <p>{error}</p>
              </div>
            )}

            {/* Submission CTAs */}
            <div className="actions pt-2">
              <PrimaryButton type="submit" disabled={submitting || !preview || preview.deductedWorkingDays <= 0}>
                {submitting ? 'Submitting application…' : 'Submit leave application'}
              </PrimaryButton>
              <GhostButton type="button" onClick={handleSaveDraft} disabled={submitting || !form.leaveTypeId || !form.startDate}>
                Save draft
              </GhostButton>
            </div>
          </form>
        </GlassCard>

        {/* Realtime Cost Breakdown Sidebar. Deliberately not sticky: pinning the breakdown
            card on its own left the Upcoming card scrolling up underneath it, so the two
            panels ran into each other, and pinning the whole column cannot work either —
            this column is the tallest item in the grid row, so its sticky container is
            exactly its own height and there is no distance for it to travel. */}
        <div className="lg:col-span-2 space-y-4">
          <GlassCard strong>
            <div className="panel-head">
              <h3 className="h3 flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-accent-text" /> Leave impact breakdown
              </h3>
            </div>

            <AnimatePresence mode="wait">
              {!preview ? (
                <p className="small muted">
                  {previewLoading ? 'Calculating…' : 'Select a leave category and valid start/end dates to calculate deducted working days.'}
                </p>
              ) : (
                <motion.div key="preview" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  <div className="calc">
                    <span className="small muted">Deducted working days</span>
                    <b className="num">
                      {preview.deductedWorkingDays}
                      <span className="small font-medium muted"> day(s)</span>
                    </b>
                  </div>

                  <div className="flex items-center justify-between bg-tint-2 rounded-md px-space-4 py-space-3">
                    <div>
                      <span className="small muted block">Balance after this leave</span>
                      <span className="small muted">{preview.effectiveBalance} day(s) available now</span>
                    </div>
                    <span className={`num font-bold ${preview.projectedBalance < 0 ? 'text-warning' : ''}`} style={{ fontSize: 'var(--font-size-4)' }}>
                      {preview.projectedBalance}
                    </span>
                  </div>

                  {preview.deductedWorkingDays <= 0 && (
                    <div className="alert alert--danger" role="alert">
                      <AlertTriangle />
                      <p>
                        <b>No working days in range:</b> the selected date(s) fall on a weekend or holiday that isn&apos;t deductible. Pick a different date.
                      </p>
                    </div>
                  )}

                  {preview.isAdvanceLeave && (
                    <div className="alert alert--warning" role="status">
                      <AlertTriangle />
                      <p>
                        <b>Advance leave flagged:</b> exceeds current available balance by {preview.shortfall} day(s). Requires managerial approval.
                      </p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </GlassCard>

          {upcoming.length > 0 && (
            <GlassCard>
              <div className="panel-head">
                <h3 className="h3 flex items-center gap-2">
                  <ListChecks className="w-4 h-4 text-accent-text" /> Upcoming
                </h3>
              </div>
              <ul className="list">
                {upcoming.map((item, i) => (
                  <li key={i}>
                    <span className="shrink-0">
                      {item.type === 'MY_LEAVE' ? (
                        <ListChecks className="w-3.5 h-3.5 text-accent-text" />
                      ) : (
                        <PartyPopper className="w-3.5 h-3.5 text-muted" />
                      )}
                    </span>
                    <span className="truncate">{item.label}</span>
                    <span className={`pill ${
                      item.type === 'MY_LEAVE' ? 'pill--accent' : item.type === 'OPTIONAL_HOLIDAY' ? 'pill--warning' : 'pill--holiday'
                    }`}>
                      {item.date}
                    </span>
                  </li>
                ))}
              </ul>
            </GlassCard>
          )}
        </div>
      </div>
    </>
  );
}
