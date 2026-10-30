import { useEffect, useState } from 'react';
import { ShieldCheck, Check, X, TriangleAlert, User, AlertCircle, Undo2, AlertTriangle, ArrowRight, CalendarDays } from 'lucide-react';
import { getApprovalsQueue, decideRequest, decideCancellation } from '../api/leaveRequests';
import GlassCard from '../components/common/GlassCard';
import { PrimaryButton, SecondaryButton, DangerButton } from '../components/common/GlassButton';
import EmptyState from '../components/common/EmptyState';
import Modal from '../components/common/Modal';
import Topbar from '../components/layout/Topbar';
import { celebrate } from '../utils/celebrate';

/** "12 Nov 2025" from a plain YYYY-MM-DD, parsed as a local date so the day never slips
 * backwards against the browser's timezone the way `new Date('2025-11-12')` does. */
function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The colour of a card's rail: what the decision needs most attention for. */
function toneOf(r) {
  if (r.decision_type === 'CANCELLATION') return 'warning';
  if (r.is_long_leave) return 'danger';
  if (r.is_advance_leave || r.is_escalated) return 'warning';
  return 'accent';
}

export default function Approvals() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState('ALL'); // 'ALL' | 'DELEGATED' | 'DIRECT' | 'ADVANCE' | 'LONG_LEAVE' | 'CANCELLATION'
  const [unelapsedInputs, setUnelapsedInputs] = useState({});
  const [processingId, setProcessingId] = useState(null);
  const [error, setError] = useState(null);

  const load = () => getApprovalsQueue().then((res) => setRequests(res.data)).catch((err) => setError(err.message)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const approve = async (r) => {
    if (processingId) return;
    setError(null);
    setProcessingId(r.request_id);
    try {
      if (r.decision_type === 'CANCELLATION') {
        const unelapsedDays = Number(unelapsedInputs[r.request_id] ?? r.deducted_days);
        await decideCancellation(r.request_id, 'APPROVE', unelapsedDays);
      } else {
        await decideRequest(r.request_id, 'APPROVE');
      }
      celebrate();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const submitReject = async () => {
    if (processingId) return;
    const target = requests.find((r) => r.request_id === rejecting);
    setError(null);
    setProcessingId(rejecting);
    try {
      if (target?.decision_type === 'CANCELLATION') {
        await decideCancellation(rejecting, 'REJECT');
      } else {
        await decideRequest(rejecting, 'REJECT', reason);
      }
      setRejecting(null);
      setReason('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const closeRejectDialog = () => {
    setRejecting(null);
    setReason('');
  };

  const advanceCount = requests.filter((r) => r.is_advance_leave).length;
  const longLeaveCount = requests.filter((r) => r.is_long_leave).length;
  const cancellationCount = requests.filter((r) => r.decision_type === 'CANCELLATION').length;
  const delegatedCount = requests.filter((r) => r.is_delegated).length;
  const directCount = requests.length - delegatedCount;

  const filteredRequests = requests.filter((r) => {
    if (filter === 'DELEGATED') return r.is_delegated;
    if (filter === 'DIRECT') return !r.is_delegated;
    if (filter === 'ADVANCE') return r.is_advance_leave;
    if (filter === 'LONG_LEAVE') return r.is_long_leave;
    if (filter === 'CANCELLATION') return r.decision_type === 'CANCELLATION';
    return true;
  });

  // A chip that can never match anything is noise, so each one appears only once the queue
  // actually holds that kind of request.
  const filters = [
    { key: 'ALL', label: `All pending (${requests.length})` },
    delegatedCount > 0 && { key: 'DELEGATED', label: `Delegated to me (${delegatedCount})`, icon: User },
    directCount > 0 && delegatedCount > 0 && { key: 'DIRECT', label: `My team (${directCount})` },
    advanceCount > 0 && { key: 'ADVANCE', label: `Advance (${advanceCount})`, icon: TriangleAlert },
    longLeaveCount > 0 && { key: 'LONG_LEAVE', label: `HR needed (${longLeaveCount})`, icon: AlertCircle },
    cancellationCount > 0 && { key: 'CANCELLATION', label: `Cancellations (${cancellationCount})`, icon: Undo2 },
  ].filter(Boolean);

  const rejectingTarget = requests.find((r) => r.request_id === rejecting);
  const rejectingIsCancellation = rejectingTarget?.decision_type === 'CANCELLATION';
  const isProcessingReject = processingId === rejecting;

  return (
    <>
      <Topbar title="Approvals" />

      <div className="page-hero">
        <div className="flex items-center gap-4 min-w-0">
          <span className="ico"><ShieldCheck /></span>
          <div className="min-w-0">
            <h1>Approvals queue</h1>
            <p>Leave your team and department is waiting on. Approve or reject, with the flags that matter on each card.</p>
          </div>
        </div>
        <span className="pill pill--accent">{requests.length} pending</span>
      </div>

      <div className="tiles">
        <div className="tile">
          <span className="ico"><ShieldCheck /></span>
          <div>
            <b className="num">{requests.length}</b>
            <span>Awaiting your decision</span>
          </div>
        </div>
        <div className="tile">
          <span className="ico"><TriangleAlert /></span>
          <div>
            <b className="num">{advanceCount}</b>
            <span>Beyond balance</span>
          </div>
        </div>
        <div className="tile">
          <span className="ico"><AlertCircle /></span>
          <div>
            <b className="num">{longLeaveCount}</b>
            <span>Long leave · needs HR</span>
          </div>
        </div>
        <div className="tile">
          <span className="ico"><Undo2 /></span>
          <div>
            <b className="num">{cancellationCount}</b>
            <span>Cancellation(s)</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert--danger" role="alert">
          <AlertTriangle />
          <p>{error}</p>
        </div>
      )}

      {filters.length > 1 && (
        <div className="page-filters" role="tablist">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`pill ${filter === f.key ? 'pill--accent' : 'pill--muted'}`}
            >
              {f.icon && <f.icon className="w-3.5 h-3.5" />} {f.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="req-list">
          {[1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 96, borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : !filteredRequests.length ? (
        <GlassCard>
          <EmptyState
            icon={ShieldCheck}
            title="Approvals queue clear"
            description={requests.length ? 'No request matches this filter. Pick another chip to see the rest.' : 'Nothing from your team is waiting on a decision.'}
          />
        </GlassCard>
      ) : (
        <div className="req-list">
          {filteredRequests.map((r) => {
            const isProcessing = processingId === r.request_id;
            return (
              <article key={r.request_id} className="req-card" data-tone={toneOf(r)}>
                <div className="req-when">
                  <span className="range">{r.employee?.full_name}</span>
                  <span className="small muted">{r.employee?.designation || 'Staff'}</span>
                  <span className="small muted flex items-center gap-1.5 mt-1">
                    <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                    {formatDate(r.start_date)}
                    {r.end_date !== r.start_date && (
                      <> <ArrowRight className="w-3.5 h-3.5" /> {formatDate(r.end_date)}</>
                    )}
                  </span>
                </div>

                <div className="req-notes">
                  <div className="req-meta">
                    <span className="pill pill--muted">
                      {r.LeaveType?.type_name} · <span className="num">{r.deducted_days}</span> day(s)
                    </span>
                    {r.decision_type === 'CANCELLATION' && <span className="pill pill--warning"><Undo2 className="w-3 h-3" /> Cancellation</span>}
                    {r.is_advance_leave && <Flag label="Beyond balance" state="warning" />}
                    {r.is_long_leave && <Flag label="Long leave · needs HR" state="danger" />}
                    {r.is_delegated && (
                      <span className="pill pill--accent">Delegated for {r.delegated_for?.full_name || 'manager'}</span>
                    )}
                    {r.is_escalated && (
                      <span className="pill pill--warning">
                        Escalated{r.escalated_from?.full_name ? ` from ${r.escalated_from.full_name}` : ''}
                      </span>
                    )}
                  </div>
                  {r.decision_type === 'CANCELLATION' && (
                    <label className="hint flex items-center gap-2 mt-1">
                      Restore on approval:
                      <input
                        type="number"
                        min="0"
                        max={r.deducted_days}
                        step="0.5"
                        className="input"
                        style={{ width: 76, minHeight: 36 }}
                        value={unelapsedInputs[r.request_id] ?? r.deducted_days}
                        onChange={(e) => setUnelapsedInputs((prev) => ({ ...prev, [r.request_id]: e.target.value }))}
                      />
                    </label>
                  )}
                </div>

                <div className="actions">
                  <PrimaryButton className="btn--sm" onClick={() => approve(r)} disabled={isProcessing}>
                    <Check /> {r.decision_type === 'CANCELLATION' ? 'Approve cancellation' : 'Approve'}
                  </PrimaryButton>
                  <SecondaryButton className="btn--sm" onClick={() => setRejecting(r.request_id)} disabled={isProcessing}>
                    <X /> Reject
                  </SecondaryButton>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        open={!!rejecting}
        onClose={closeRejectDialog}
        title={rejectingIsCancellation ? 'Reject cancellation' : 'Reject leave request'}
      >
        {rejectingIsCancellation ? (
          <p className="small">Reject this cancellation request? The leave stays Approved as-is.</p>
        ) : (
          <div className="field">
            <label htmlFor="reject-reason">Reason for rejection</label>
            <textarea
              id="reject-reason"
              className="input"
              rows={4}
              placeholder="Enter explicit reason for rejection..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          </div>
        )}
        <div className="actions" style={{ marginTop: 'var(--space-4)', justifyContent: 'flex-end' }}>
          <SecondaryButton onClick={closeRejectDialog} disabled={isProcessingReject}>Cancel</SecondaryButton>
          <DangerButton onClick={submitReject} disabled={isProcessingReject || (!rejectingIsCancellation && !reason.trim())}>
            Confirm rejection
          </DangerButton>
        </div>
      </Modal>
    </>
  );
}

function Flag({ label, state }) {
  return (
    <span className={`pill pill--${state}`}>
      <TriangleAlert className="w-3 h-3" /> {label}
    </span>
  );
}
