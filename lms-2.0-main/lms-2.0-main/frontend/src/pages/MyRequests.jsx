import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks, PlaneTakeoff, CalendarDays, ArrowRight, Clock } from 'lucide-react';
import { getMyRequests, withdrawRequest, requestCancellation, submitDraft, discardDraft } from '../api/leaveRequests';
import GlassCard from '../components/common/GlassCard';
import StatusBadge from '../components/common/StatusBadge';
import { daysLeftToWithdraw } from '../utils/withdrawWindow';
import { LopDecision } from '../components/common/LossOfPayPanel';
import { GhostButton, PrimaryButton } from '../components/common/GlassButton';
import EmptyState from '../components/common/EmptyState';
import Topbar from '../components/layout/Topbar';

const WITHDRAWABLE = ['PENDING_MANAGER', 'PENDING_HR', 'REJECTED_PENDING_WITHDRAWAL'];
const AWAITING_DECISION = ['PENDING_MANAGER', 'PENDING_HR', 'CANCELLATION_REQUESTED'];

/** The colour of a card's status rail. One tone per outcome rather than one per state, so
 * the list reads at a glance and every new state still lands somewhere sensible. */
const TONE_BY_STATE = {
  DRAFT: 'muted',
  PENDING_MANAGER: 'accent',
  PENDING_HR: 'accent',
  CANCELLATION_REQUESTED: 'accent',
  APPROVED: 'success',
  REJECTED: 'danger',
  REJECTED_PENDING_WITHDRAWAL: 'warning',
  LOP_APPLIED: 'warning',
  WITHDRAWN: 'muted',
  CANCELLED: 'muted',
};

/** Tabs across the top. `match` decides which requests a tab holds; `null` means all. */
const FILTERS = [
  { key: 'ALL', label: 'All', match: null },
  { key: 'OPEN', label: 'Awaiting a decision', match: (r) => AWAITING_DECISION.includes(r.state) },
  { key: 'APPROVED', label: 'Approved', match: (r) => r.state === 'APPROVED' },
  { key: 'DRAFT', label: 'Drafts', match: (r) => r.state === 'DRAFT' },
  { key: 'CLOSED', label: 'Closed', match: (r) => ['REJECTED', 'REJECTED_PENDING_WITHDRAWAL', 'WITHDRAWN', 'CANCELLED', 'LOP_APPLIED'].includes(r.state) },
];

/** "Mon, 12 Nov 2025" from a plain YYYY-MM-DD, parsed as a local date so the day never
 * slips backwards against the browser's timezone the way `new Date('2025-11-12')` does. */
function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Withdraw within 6 day(s) or it becomes loss of pay" under a rejected advance request. */
function WithdrawCountdown({ request }) {
  if (Number(request.lop_days) > 0 && ['PENDING', 'CONFIRMED'].includes(request.lop_status)) {
    return (
      <p className="small muted" data-testid="lop-note">
        {request.lop_days} of {request.deducted_days} day(s) are loss of pay
        {request.lop_status === 'PENDING' ? ' (your decision is due)' : ''}.
      </p>
    );
  }
  const left = daysLeftToWithdraw(request);
  if (left === null) return null;
  return (
    <p className="small flex items-center gap-1.5" style={{ color: 'var(--color-warning-text, inherit)' }} data-testid="withdraw-countdown">
      <Clock className="w-3.5 h-3.5 shrink-0" />
      {left > 0 ? `Withdraw within ${left} day(s)` : 'Withdraw today'} or {request.deducted_days ?? ''} day(s) become loss of pay.
    </p>
  );
}

export default function MyRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('ALL');

  const load = () => getMyRequests().then((res) => setRequests(res.data)).catch((err) => setError(err.message)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const handleSubmitDraft = (id) => submitDraft(id).then(load).catch((err) => setError(err.message));

  // Counts come off the same predicates the tabs filter by, so a chip can never promise a
  // number the list below it does not show.
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, f.match ? requests.filter(f.match).length : requests.length])),
    [requests],
  );
  const activeFilter = FILTERS.find((f) => f.key === filter) || FILTERS[0];
  const visible = activeFilter.match ? requests.filter(activeFilter.match) : requests;

  const approvedDays = useMemo(
    () => requests.filter((r) => r.state === 'APPROVED').reduce((sum, r) => sum + Number(r.deducted_days || 0), 0),
    [requests],
  );

  const rowActions = (r) => (
    <div className="actions">
      {r.state === 'DRAFT' && (
        <>
          <PrimaryButton className="btn--sm" onClick={() => handleSubmitDraft(r.request_id)}>Submit</PrimaryButton>
          <GhostButton className="btn--sm" onClick={() => discardDraft(r.request_id).then(load).catch((err) => setError(err.message))}>Discard</GhostButton>
        </>
      )}
      {WITHDRAWABLE.includes(r.state) && (
        <GhostButton className="btn--sm" onClick={() => withdrawRequest(r.request_id).then(load).catch((err) => setError(err.message))}>
          Withdraw
        </GhostButton>
      )}
      {r.lop_status === 'PENDING' && <LopDecision request={r} onDone={load} compact />}
      {r.state === 'APPROVED' && r.lop_status !== 'PENDING' && (
        <GhostButton className="btn--sm" onClick={() => requestCancellation(r.request_id).then(load).catch((err) => setError(err.message))}>
          Request cancellation
        </GhostButton>
      )}
    </div>
  );

  return (
    <>
      <Topbar title="My Requests" />

      <div className="page-hero">
        <div className="flex items-center gap-4 min-w-0">
          <span className="ico"><ListChecks /></span>
          <div className="min-w-0">
            <h1>Your leave history</h1>
            <p>Every request you have raised, what it is waiting on, and what you can still do about it.</p>
          </div>
        </div>
        <Link to="/apply" className="btn btn--primary shrink-0">
          <PlaneTakeoff className="w-4 h-4" /> Apply for leave
        </Link>
      </div>

      <div className="tiles">
        <div className="tile">
          <span className="ico"><ListChecks /></span>
          <div>
            <b className="num">{requests.length}</b>
            <span>Request(s) raised</span>
          </div>
        </div>
        <div className="tile">
          <span className="ico"><Clock /></span>
          <div>
            <b className="num">{counts.OPEN}</b>
            <span>Awaiting a decision</span>
          </div>
        </div>
        <div className="tile">
          <span className="ico"><CalendarDays /></span>
          <div>
            <b className="num">{approvedDays.toFixed(1)}</b>
            <span>Approved day(s)</span>
          </div>
        </div>
        <div className="tile">
          <span className="ico"><PlaneTakeoff /></span>
          <div>
            <b className="num">{counts.DRAFT}</b>
            <span>Draft(s) to finish</span>
          </div>
        </div>
      </div>

      {error && <p className="error-msg">{error}</p>}

      {/* Empty tabs are still shown: "Drafts (0)" is information, and a tab list that
          changes shape as requests move state is harder to aim at than one that doesn't. */}
      <div className="page-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`pill ${filter === f.key ? 'pill--accent' : 'pill--muted'}`}
          >
            {f.label} ({counts[f.key]})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="req-list">
          {[1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 88, borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : !visible.length ? (
        <GlassCard>
          <EmptyState
            icon={ListChecks}
            title={requests.length ? 'Nothing in this view' : 'No requests yet'}
            description={
              requests.length
                ? 'No request is in this state right now. Pick another tab to see the rest.'
                : 'Your leave history will appear here once you apply.'
            }
          />
        </GlassCard>
      ) : (
        <div className="req-list">
          {visible.map((r) => (
            <article key={r.request_id} className="req-card" data-tone={TONE_BY_STATE[r.state] || 'muted'}>
              <div className="req-when">
                <Link to={`/my-requests/${r.request_id}`} className="range">
                  {formatDate(r.start_date)}
                  {r.end_date !== r.start_date && (
                    <> <ArrowRight className="w-3.5 h-3.5 inline align-[-2px]" /> {formatDate(r.end_date)}</>
                  )}
                </Link>
                <span className="small muted">
                  {r.LeaveType?.type_name || 'Leave'} · <span className="num">{r.deducted_days ?? '—'}</span> day(s)
                </span>
              </div>

              <div className="req-notes">
                <div className="req-meta">
                  <StatusBadge state={r.state} />
                  {AWAITING_DECISION.includes(r.state) && r.currentApprover && (
                    <span className="small muted">with {r.currentApprover.full_name}</span>
                  )}
                </div>
                <WithdrawCountdown request={r} />
                {r.is_self_approved && (
                  <p className="small muted">Self-approved — no higher authority on record</p>
                )}
              </div>

              {rowActions(r)}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
