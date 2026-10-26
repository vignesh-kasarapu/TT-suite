import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, XCircle, Eye, Paperclip, Clock, UserPlus, X } from 'lucide-react';
import { getRequestDetail, addWatcher, removeWatcher } from '../api/leaveRequests';
import { attachmentDownloadUrl } from '../api/attachments';
import { getWatchableEmployees } from '../api/employees';
import { useAuth } from '../context/AuthContext';
import GlassCard from '../components/common/GlassCard';
import StatusBadge from '../components/common/StatusBadge';
import { PrimaryButton } from '../components/common/GlassButton';
import Topbar from '../components/layout/Topbar';

const AWAITING_DECISION = ['PENDING_MANAGER', 'PENDING_HR', 'CANCELLATION_REQUESTED'];

export default function RequestDetail() {
  const { requestId } = useParams();
  const { hasRole } = useAuth();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState([]);
  const [picked, setPicked] = useState('');
  const [adding, setAdding] = useState(false);
  const [watcherError, setWatcherError] = useState(null);

  const load = () => getRequestDetail(requestId).then((res) => setRequest(res.data)).finally(() => setLoading(false));
  useEffect(() => { load(); }, [requestId]);
  useEffect(() => {
    if (hasRole('MANAGER', 'HR_ADMIN')) getWatchableEmployees().then((res) => setCandidates(res.data)).catch((err) => setWatcherError(err.message));
  }, []);

  const submitWatcher = async () => {
    if (!picked) return;
    setAdding(true);
    setWatcherError(null);
    try {
      await addWatcher(requestId, picked);
      setPicked('');
      load();
    } catch (err) {
      setWatcherError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const removeWatcherClick = (watcherId) => {
    setWatcherError(null);
    removeWatcher(requestId, watcherId).then(load).catch((err) => setWatcherError(err.message));
  };

  if (loading) return <><Topbar title="Request detail" /><div className="skel" style={{ height: 256, borderRadius: 'var(--radius-lg)' }} /></>;
  if (!request) return <><Topbar title="Request detail" /><GlassCard>Request not found.</GlassCard></>;

  return (
    <>
      <Topbar title={`Request #${request.request_id}`} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <GlassCard>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="h2">{request.start_date} → {request.end_date}</p>
                <p className="small muted mt-1">
                  {request.LeaveType?.type_name} · <span className="num">{request.deducted_days}</span> day(s)
                  {request.is_half_day && ` · ${request.half_day_portion?.toLowerCase()} half`}
                </p>
              </div>
              <StatusBadge state={request.state} />
            </div>

            {(request.is_advance_leave || request.is_long_leave) && (
              <div className="flex gap-2 flex-wrap mb-4">
                {request.is_advance_leave && <span className="pill pill--warning">Advance leave</span>}
                {request.is_long_leave && <span className="pill pill--danger">Long leave — HR stage</span>}
              </div>
            )}

            {request.reason && (
              <>
                <p className="small muted mb-1.5">Reason</p>
                <p className="small bg-tint-2 rounded-md px-space-4 py-space-3">{request.reason}</p>
              </>
            )}
          </GlassCard>

          <GlassCard>
            <h3 className="h3 mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-accent-text" /> Approval timeline
            </h3>
            {AWAITING_DECISION.includes(request.state) && request.currentApprover && (
              <p className="small mb-3">
                Currently pending with: <span className="font-medium">{request.currentApprover.full_name}</span>
              </p>
            )}
            {request.scope === 'WATCHER_MASKED' && !request.approvals ? (
              <p className="small muted">Approval details are not shown in this limited view.</p>
            ) : !request.approvals?.length ? (
              <p className="small muted">
                {AWAITING_DECISION.includes(request.state) ? 'No decision yet at this stage.' : 'No decisions recorded yet.'}
              </p>
            ) : (
              <div className="space-y-3">
                {request.approvals.map((a) => (
                  <div key={a.approval_id} className="flex items-start gap-3">
                    {a.decision === 'APPROVE' ? (
                      <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-danger-text mt-0.5 shrink-0" />
                    )}
                    <div className="small">
                      <p>
                        <span className="font-medium">{a.stage}</span> · {a.decision === 'APPROVE' ? 'Approved' : 'Rejected'}
                        {a.on_behalf_of_id && ' (as delegate)'}
                      </p>
                      {a.reason && <p className="muted small mt-0.5">{a.reason}</p>}
                      <p className="muted small mt-0.5">{new Date(a.decision_timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>

        <div className="space-y-4">
          <GlassCard>
            <h3 className="h3 mb-3 flex items-center gap-2">
              <Eye className="w-4 h-4 text-accent-text" /> Watchers
            </h3>
            {!request.watchers?.length ? (
              <p className="small muted mb-3">No watchers on this request.</p>
            ) : (
              <div className="space-y-2 mb-3">
                {request.watchers.map((w) => (
                  <div key={w.watcher_id} className="flex items-center justify-between small bg-tint-2 rounded-sm px-space-3 py-space-2">
                    <span>{w.watcherEmployee?.full_name || `Employee #${w.watcher_employee_id}`}</span>
                    {hasRole('MANAGER', 'HR_ADMIN') && (
                      <button onClick={() => removeWatcherClick(w.watcher_id)} className="muted" aria-label="Remove watcher">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {hasRole('MANAGER', 'HR_ADMIN') && candidates.length > 0 && (
              <div className="flex gap-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                <select className="input" value={picked} onChange={(e) => setPicked(e.target.value)}>
                  <option value="">Add a watcher…</option>
                  {candidates
                    .filter((c) => !request.watchers?.some((w) => w.watcher_employee_id === c.employee_id))
                    .map((c) => <option key={c.employee_id} value={c.employee_id}>{c.full_name}</option>)}
                </select>
                <PrimaryButton onClick={submitWatcher} disabled={!picked || adding}>
                  <UserPlus className="w-3.5 h-3.5" />
                </PrimaryButton>
              </div>
            )}
            {watcherError && <p className="error-msg mt-2">{watcherError}</p>}
          </GlassCard>

          {request.LeaveType?.permits_attachments && (
            <GlassCard>
              <h3 className="h3 mb-3 flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-accent-text" /> Attachments
              </h3>
              {!request.attachments?.length ? (
                <p className="small muted">No attachments uploaded.</p>
              ) : (
                <div className="space-y-2">
                  {request.attachments.map((a) => (
                    <a key={a.attachment_id} href={attachmentDownloadUrl(a.attachment_id)} target="_blank" rel="noreferrer"
                      className="flex items-center justify-between small bg-tint-2 rounded-sm px-space-3 py-space-2">
                      <span className="truncate">{a.file_name}</span>
                      <span className="muted shrink-0 ml-2">{(a.size_bytes / 1024).toFixed(0)} KB</span>
                    </a>
                  ))}
                </div>
              )}
            </GlassCard>
          )}
        </div>
      </div>
    </>
  );
}
