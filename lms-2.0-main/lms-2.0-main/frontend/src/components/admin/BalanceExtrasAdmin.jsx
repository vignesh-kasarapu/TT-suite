import { useCallback, useEffect, useState } from 'react';
import { DollarSign, Clock3, Check, X, AlertTriangle } from 'lucide-react';
import {
  createEncashment, listEncashments, decideEncashment, getEncashableBalance,
  listPendingCompOff, decideCompOff, listLeaveTypesShort,
} from '../../api/admin';
import { listEmployees, getDashboard } from '../../api/employees';
import GlassCard from '../common/GlassCard';
import { PrimaryButton, GhostButton } from '../common/GlassButton';
import { listConfig } from '../../api/config';
import { formatServerDate } from '../../utils/serverTime';

/** Which leave type may be encashed is a setting (`encashment.leave_type_code`), not a
 * constant: a company whose paid leave is not called ANNUAL configures its own, and a fresh
 * database with no leave types at all simply has nothing to offer here. The backend enforces
 * the same setting, so the two can never disagree. */
const ENCASHABLE_TYPE_CONFIG_KEY = 'encashment.leave_type_code';
const DEFAULT_ENCASHABLE_TYPE_CODE = 'ANNUAL';

const STATUS_PILL = {
  REQUESTED: 'pill--warning',
  POSTED: 'pill--success',
  REJECTED: 'pill--danger',
  PENDING_MANAGER: 'pill--accent',
  PENDING_HR: 'pill--warning',
  APPROVED: 'pill--success',
};

const statusLabel = (status) => status.replaceAll('_', ' ').toLowerCase();

export default function BalanceExtrasAdmin({ leaveYearId: leaveYearIdProp } = {}) {
  const [employees, setEmployees] = useState([]);
  const [annualType, setAnnualType] = useState(null);
  const [encashableCode, setEncashableCode] = useState(DEFAULT_ENCASHABLE_TYPE_CODE);
  const [fetchedLeaveYearId, setFetchedLeaveYearId] = useState(null);
  const [encashForm, setEncashForm] = useState({ employeeId: '', daysEncashed: '', notes: '' });
  const [balance, setBalance] = useState(null);
  const [requests, setRequests] = useState([]);
  const [compOffQueue, setCompOffQueue] = useState([]);
  const [encashResult, setEncashResult] = useState(null);
  const [compOffResult, setCompOffResult] = useState(null);
  const [savingEncash, setSavingEncash] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const leaveYearId = leaveYearIdProp ?? fetchedLeaveYearId;

  useEffect(() => {
    listEmployees().then((res) => setEmployees(res.data)).catch(() => {});
    Promise.all([listLeaveTypesShort(), listConfig().catch(() => ({ data: [] }))])
      .then(([types, config]) => {
        const configured = (config.data || []).find((c) => c.config_key === ENCASHABLE_TYPE_CONFIG_KEY);
        const code = (configured?.config_value || DEFAULT_ENCASHABLE_TYPE_CODE).toUpperCase();
        setEncashableCode(code);
        setAnnualType(types.data.find((t) => t.type_code === code) || null);
      })
      .catch(() => {});
    if (leaveYearIdProp == null) {
      getDashboard().then((res) => setFetchedLeaveYearId(res.data.leaveYear?.leave_year_id)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRequests = useCallback(() => {
    listEncashments().then((res) => setRequests(res.data)).catch(() => {});
    listPendingCompOff().then((res) => setCompOffQueue(res.data)).catch(() => {});
  }, []);
  useEffect(() => { loadRequests(); }, [loadRequests]);

  // What this employee may still ask for: balance minus days already reserved by requests
  // waiting on a decision. Shown before anything is typed, so HR is not guessing.
  useEffect(() => {
    const { employeeId } = encashForm;
    if (!employeeId || !annualType || !leaveYearId) { setBalance(null); return; }
    getEncashableBalance({ employeeId, leaveTypeId: annualType.leave_type_id, leaveYearId })
      .then((res) => setBalance(res.data))
      .catch(() => setBalance(null));
  }, [encashForm.employeeId, annualType, leaveYearId, requests]);

  const submitEncash = async (e) => {
    e.preventDefault();
    setSavingEncash(true);
    setEncashResult(null);
    try {
      await createEncashment({
        employeeId: encashForm.employeeId, leaveTypeId: annualType.leave_type_id, leaveYearId,
        daysEncashed: encashForm.daysEncashed, notes: encashForm.notes,
      });
      setEncashResult({ ok: true, message: `Requested ${encashForm.daysEncashed} day(s) — awaiting approval below.` });
      setEncashForm((f) => ({ ...f, daysEncashed: '', notes: '' }));
      loadRequests();
    } catch (err) {
      setEncashResult({ ok: false, message: err.message });
    } finally {
      setSavingEncash(false);
    }
  };

  const decide = async (kind, id, approve) => {
    setBusyId(`${kind}-${id}`);
    const setResult = kind === 'encash' ? setEncashResult : setCompOffResult;
    setResult(null);
    try {
      await (kind === 'encash' ? decideEncashment(id, approve, null) : decideCompOff(id, approve, null));
      setResult({ ok: true, message: approve ? 'Approved.' : 'Rejected.' });
      loadRequests();
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const maxDays = balance?.max_days_per_request || 0;
  const pendingEncashments = requests.filter((r) => r.status === 'REQUESTED');
  const decidedEncashments = requests.filter((r) => r.status !== 'REQUESTED');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <GlassCard>
        <h3 className="h3 mb-1 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-accent-text" /> Leave encashment
        </h3>
        <p className="small muted mb-4">
          One leave type only, the one set as encashable. A request reserves the days; the balance
          moves when it is approved.
          Days are recorded for payroll — no salary is calculated here.
        </p>

        {!annualType ? (
          <div className="alert alert--warning">
            <AlertTriangle />
            <p>
              No leave type with the code <span className="num">{encashableCode}</span> exists yet, so there is
              nothing to encash. Create it in Leave types &amp; policy, or point the setting
              <span className="num"> {ENCASHABLE_TYPE_CONFIG_KEY}</span> at the type you encash.
            </p>
          </div>
        ) : (
          <form onSubmit={submitEncash} className="space-y-3">
            <select className="input" value={encashForm.employeeId} required
              onChange={(e) => setEncashForm((f) => ({ ...f, employeeId: e.target.value }))}>
              <option value="">Employee…</option>
              {employees.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.full_name}</option>)}
            </select>

            <div className="input" style={{ display: 'flex', alignItems: 'center', background: 'var(--color-tint-2)' }}>
              {annualType.type_name} — the encashable type
            </div>

            {balance && (
              <div className="calc">
                <span className="muted small">Available to encash</span>
                <b className="num">{balance.encashable_balance.toFixed(1)}</b>
                <span className="muted small">
                  {balance.effective_balance.toFixed(1)} day(s) balance
                  {balance.reserved_by_pending_encashments > 0
                    && ` · ${balance.reserved_by_pending_encashments.toFixed(1)} reserved by pending requests`}
                  {maxDays > 0 ? ` · at most ${maxDays} per request` : ' · no per-request maximum set'}
                </span>
              </div>
            )}

            <input type="number" min="0" step="0.5" max={maxDays || undefined} className="input"
              placeholder="Days to encash" value={encashForm.daysEncashed} required
              onChange={(e) => setEncashForm((f) => ({ ...f, daysEncashed: e.target.value }))} />
            <input className="input" placeholder="Reason / notes" value={encashForm.notes}
              onChange={(e) => setEncashForm((f) => ({ ...f, notes: e.target.value }))} />
            {encashResult && (
              <p className="small" style={{ color: encashResult.ok ? 'var(--color-success)' : 'var(--color-danger-text)' }}>
                {encashResult.message}
              </p>
            )}
            <PrimaryButton type="submit" disabled={savingEncash || !leaveYearId} className="w-full">
              {savingEncash ? 'Submitting…' : 'Submit encashment request'}
            </PrimaryButton>
          </form>
        )}

        <h4 className="small font-medium mt-5 mb-2">Awaiting approval ({pendingEncashments.length})</h4>
        {!pendingEncashments.length ? (
          <p className="small muted">No encashment requests are waiting.</p>
        ) : (
          <div className="space-y-2">
            {pendingEncashments.map((r) => (
              <div key={r.encashment_id} className="panel-row">
                <div className="min-w-0">
                  <span className="when">{r.employee_name}</span>
                  <p className="what">
                    <span className="num">{r.days_encashed}</span> day(s) · {r.leave_type_name}
                    {r.notes ? ` · ${r.notes}` : ''}
                  </p>
                </div>
                <div className="actions">
                  <PrimaryButton className="btn--sm" disabled={busyId === `encash-${r.encashment_id}`}
                    onClick={() => decide('encash', r.encashment_id, true)}>
                    <Check /> Approve
                  </PrimaryButton>
                  <GhostButton className="btn--sm" disabled={busyId === `encash-${r.encashment_id}`}
                    onClick={() => decide('encash', r.encashment_id, false)}>
                    <X /> Reject
                  </GhostButton>
                </div>
              </div>
            ))}
          </div>
        )}

        {decidedEncashments.length > 0 && (
          <>
            <h4 className="small font-medium mt-5 mb-2">Decided</h4>
            <ul className="list">
              {decidedEncashments.slice(0, 10).map((r) => (
                <li key={r.encashment_id}>
                  <span className="date num">{formatServerDate(r.requested_at)}</span>
                  <span className="truncate">
                    {r.employee_name} · <span className="num">{r.days_encashed}</span> day(s)
                    {r.decided_by_name ? ` · by ${r.decided_by_name}` : ''}
                  </span>
                  <span className={`pill ${STATUS_PILL[r.status] || 'pill--muted'}`}>{statusLabel(r.status)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </GlassCard>

      <GlassCard>
        <h3 className="h3 mb-1 flex items-center gap-2">
          <Clock3 className="w-4 h-4 text-accent-text" /> Compensatory off
        </h3>
        <p className="small muted mb-4">
          Everything waiting on you: claims at the HR stage, plus manager-stage claims from
          your own reports. 8 approved hours = 1 comp-off day; the balance is credited only on
          the final HR approval.
        </p>

        {compOffResult && (
          <p className="small mb-3" style={{ color: compOffResult.ok ? 'var(--color-success)' : 'var(--color-danger-text)' }}>
            {compOffResult.message}
          </p>
        )}

        {!compOffQueue.length ? (
          <p className="small muted">Nothing is waiting for an HR decision.</p>
        ) : (
          <div className="space-y-2">
            {compOffQueue.map((r) => (
              <div key={r.comp_off_id} className="panel-row">
                <div className="min-w-0">
                  <span className="when">
                    {r.employee_name}{' '}
                    <span className={`pill ${STATUS_PILL[r.status] || 'pill--muted'}`}>{statusLabel(r.status)}</span>
                  </span>
                  <p className="what">
                    {r.work_date} · <span className="num">{r.hours_worked ?? '—'}</span> hour(s)
                    {' → '}<span className="num">{r.hours_or_days}</span> day(s)
                    {r.notes ? ` · ${r.notes}` : ''}
                  </p>
                </div>
                <div className="actions">
                  <PrimaryButton className="btn--sm" disabled={busyId === `comp-${r.comp_off_id}`}
                    onClick={() => decide('comp', r.comp_off_id, true)}>
                    <Check /> Approve
                  </PrimaryButton>
                  <GhostButton className="btn--sm" disabled={busyId === `comp-${r.comp_off_id}`}
                    onClick={() => decide('comp', r.comp_off_id, false)}>
                    <X /> Reject
                  </GhostButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
