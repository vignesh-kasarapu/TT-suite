import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import { getMyRequests, withdrawRequest, requestCancellation, submitDraft, discardDraft } from '../api/leaveRequests';
import GlassCard from '../components/common/GlassCard';
import StatusBadge from '../components/common/StatusBadge';
import { GhostButton, PrimaryButton } from '../components/common/GlassButton';
import EmptyState from '../components/common/EmptyState';
import ResponsiveList from '../components/common/ResponsiveList';
import Topbar from '../components/layout/Topbar';

const WITHDRAWABLE = ['PENDING_MANAGER', 'PENDING_HR', 'REJECTED_PENDING_WITHDRAWAL'];
const AWAITING_DECISION = ['PENDING_MANAGER', 'PENDING_HR', 'CANCELLATION_REQUESTED'];

export default function MyRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => getMyRequests().then((res) => setRequests(res.data)).catch((err) => setError(err.message)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const handleSubmitDraft = (id) => submitDraft(id).then(load).catch((err) => setError(err.message));

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
      {r.state === 'APPROVED' && (
        <GhostButton className="btn--sm" onClick={() => requestCancellation(r.request_id).then(load).catch((err) => setError(err.message))}>
          Request cancellation
        </GhostButton>
      )}
    </div>
  );

  const columns = [
    {
      key: 'dates',
      label: 'Dates',
      nowrap: true,
      render: (r) => (
        <Link to={`/my-requests/${r.request_id}`} className="name num">
          {r.start_date} → {r.end_date}
        </Link>
      ),
    },
    {
      key: 'leave',
      label: 'Leave',
      render: (r) => (
        <>
          <div>
            {r.LeaveType?.type_name || 'Leave'} · <span className="num">{r.deducted_days ?? '—'}</span> day(s)
          </div>
          {AWAITING_DECISION.includes(r.state) && r.currentApprover && (
            <div className="small muted">Pending with: {r.currentApprover.full_name}</div>
          )}
          {r.is_self_approved && (
            <div className="small muted">Self-approved — no higher authority on record</div>
          )}
        </>
      ),
    },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge state={r.state} /> },
    { key: 'actions', label: 'Actions', render: rowActions },
  ];

  return (
    <>
      <Topbar title="My Requests" />
      {error && <p className="error-msg mb-3">{error}</p>}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 56, borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <ResponsiveList
          columns={columns}
          rows={requests}
          rowKey={(r) => r.request_id}
          empty={
            <GlassCard>
              <EmptyState icon={ListChecks} title="No requests yet" description="Your leave history will appear here once you apply." />
            </GlassCard>
          }
          renderCard={(r) => (
            <>
              <header>
                <Link to={`/my-requests/${r.request_id}`} className="name num">{r.start_date} → {r.end_date}</Link>
                <StatusBadge state={r.state} />
              </header>
              <div className="small">
                {r.LeaveType?.type_name || 'Leave'} · <span className="num">{r.deducted_days ?? '—'}</span> day(s)
              </div>
              {AWAITING_DECISION.includes(r.state) && r.currentApprover && (
                <div className="small muted">Pending with: {r.currentApprover.full_name}</div>
              )}
              {r.is_self_approved && (
                <div className="small muted">Self-approved — no higher authority on record</div>
              )}
              {rowActions(r)}
            </>
          )}
        />
      )}
    </>
  );
}
