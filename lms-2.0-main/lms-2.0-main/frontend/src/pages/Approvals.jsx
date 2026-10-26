import { useEffect, useState } from 'react';
import { ShieldCheck, Check, X, TriangleAlert, User, AlertCircle, Undo2, AlertTriangle } from 'lucide-react';
import { getApprovalsQueue, decideRequest, decideCancellation } from '../api/leaveRequests';
import GlassCard from '../components/common/GlassCard';
import { PrimaryButton, SecondaryButton, DangerButton } from '../components/common/GlassButton';
import EmptyState from '../components/common/EmptyState';
import Modal from '../components/common/Modal';
import ResponsiveList from '../components/common/ResponsiveList';
import Topbar from '../components/layout/Topbar';
import { celebrate } from '../utils/celebrate';

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

  const columns = [
    {
      key: 'employee',
      label: 'Employee',
      render: (r) => (
        <div>
          <span className="name">{r.employee?.full_name}</span>{' '}
          <span className="pill pill--muted">{r.employee?.designation || 'Staff'}</span>
          {r.is_delegated && (
            <span className="pill pill--accent" style={{ marginLeft: 6 }}>
              Delegated for {r.delegated_for?.full_name || 'manager'}
            </span>
          )}
          {r.is_escalated && (
            <span className="pill pill--warning" style={{ marginLeft: 6 }}>
              (Escalated{r.escalated_from?.full_name ? ` from ${r.escalated_from.full_name}` : ''})
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'leave',
      label: 'Leave',
      nowrap: true,
      render: (r) => (
        <span>
          {r.LeaveType?.type_name}
          {r.decision_type === 'CANCELLATION' && <span className="pill pill--warning" style={{ marginLeft: 6 }}>Cancellation</span>}
        </span>
      ),
    },
    {
      key: 'dates',
      label: 'Dates',
      nowrap: true,
      render: (r) => <span className="num">{r.start_date} → {r.end_date}</span>,
    },
    {
      key: 'days',
      label: 'Days',
      numeric: true,
      render: (r) => <span className="num">{r.deducted_days}</span>,
    },
    {
      key: 'flags',
      label: 'Flags',
      render: (r) => (
        <div className="flex flex-col gap-1.5">
          {r.is_advance_leave && <Flag label="Advance leave" state="warning" />}
          {r.is_long_leave && <Flag label="Long leave · needs HR" state="danger" />}
          {r.decision_type === 'CANCELLATION' && (
            <label className="hint flex items-center gap-2">
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
      ),
    },
    {
      key: 'decision',
      label: 'Decision',
      render: (r) => {
        const isProcessing = processingId === r.request_id;
        return (
          <div className="actions">
            <PrimaryButton className="btn--sm" onClick={() => approve(r)} disabled={isProcessing}>
              <Check /> {r.decision_type === 'CANCELLATION' ? 'Approve cancellation' : 'Approve'}
            </PrimaryButton>
            <SecondaryButton className="btn--sm" onClick={() => setRejecting(r.request_id)} disabled={isProcessing}>
              <X /> Reject
            </SecondaryButton>
          </div>
        );
      },
    },
  ];

  const renderCard = (r) => {
    const isProcessing = processingId === r.request_id;
    return (
      <>
        <header>
          <span className="name">{r.employee?.full_name}</span>
          <span className="pill pill--muted">{r.employee?.designation || 'Staff'}</span>
        </header>
        <div>
          {r.LeaveType?.type_name}, <span className="num">{r.deducted_days}</span> day(s)
          {r.decision_type === 'CANCELLATION' && <span className="pill pill--warning" style={{ marginLeft: 6 }}>Cancellation</span>}
          {r.is_delegated && <span className="pill pill--accent" style={{ marginLeft: 6 }}>Delegated for {r.delegated_for?.full_name || 'manager'}</span>}
          {r.is_escalated && <span className="pill pill--warning" style={{ marginLeft: 6 }}>(Escalated{r.escalated_from?.full_name ? ` from ${r.escalated_from.full_name}` : ''})</span>}
        </div>
        <div className="meta">
          <span className="num">{r.start_date} → {r.end_date}</span>
        </div>
        {(r.is_advance_leave || r.is_long_leave) && (
          <div className="flex gap-2 flex-wrap">
            {r.is_advance_leave && <Flag label="Advance leave" state="warning" />}
            {r.is_long_leave && <Flag label="Long leave · needs HR" state="danger" />}
          </div>
        )}
        {r.decision_type === 'CANCELLATION' && (
          <label className="hint flex items-center gap-2">
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
        <div className="actions">
          <PrimaryButton className="btn--sm" onClick={() => approve(r)} disabled={isProcessing}>
            <Check /> {r.decision_type === 'CANCELLATION' ? 'Approve cancellation' : 'Approve'}
          </PrimaryButton>
          <SecondaryButton className="btn--sm" onClick={() => setRejecting(r.request_id)} disabled={isProcessing}>
            <X /> Reject
          </SecondaryButton>
        </div>
      </>
    );
  };

  return (
    <>
      <Topbar title="Approvals" />

      <GlassCard className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="ico" style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'var(--color-tint-2)', display: 'grid', placeItems: 'center', color: 'var(--color-accent-text)' }}>
              <ShieldCheck />
            </span>
            <div>
              <h2 className="h2 flex items-center gap-2 flex-wrap">
                Leave approvals queue
                <span className="pill pill--accent">{requests.length} request{requests.length === 1 ? '' : 's'}</span>
              </h2>
              <p className="muted small">Review pending requests from your team and department.</p>
            </div>
          </div>
        </div>

        <div className="tabs" role="tablist" style={{ overflowX: 'auto' }}>
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className="flex items-center gap-1.5"
            >
              {f.icon && <f.icon className="w-3.5 h-3.5" />} {f.label}
            </button>
          ))}
        </div>
      </GlassCard>

      {error && (
        <div className="alert alert--danger mt-4" role="alert">
          <AlertTriangle />
          <p>{error}</p>
        </div>
      )}

      <div className="mt-4">
        {loading ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 72, borderRadius: 'var(--radius-md)' }} />)}
          </div>
        ) : !filteredRequests.length ? (
          <GlassCard>
            <EmptyState icon={ShieldCheck} title="Approvals queue clear" description="There are no pending requests matching your filter." />
          </GlassCard>
        ) : (
          <ResponsiveList
            columns={columns}
            rows={filteredRequests}
            rowKey={(r) => r.request_id}
            renderCard={renderCard}
          />
        )}
      </div>

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
