import { useState } from 'react';
import { AlertTriangle, Wallet } from 'lucide-react';
import { acceptLop, withdrawLop } from '../../api/leaveRequests';
import GlassCard from './GlassCard';
import { GhostButton, PrimaryButton } from './GlassButton';
import { parseServerDate } from '../../utils/serverTime';

/** Hours (rounded up) left to decide on the LOP days of an approved advance leave. */
export const hoursLeftToDecide = (r) => {
  if (r.lop_status !== 'PENDING' || !r.lop_decision_deadline) return null;
  const raw = r.lop_decision_deadline;
  const end = parseServerDate(raw);
  return Math.max(Math.ceil((end - Date.now()) / 3_600_000), 0);
};

/** Accept / Withdraw for one approved advance leave whose extra days are loss of pay. */
export function LopDecision({ request, onDone, compact = false }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const hours = hoursLeftToDecide(request);
  if (hours === null) return null;

  const act = async (kind) => {
    setBusy(kind);
    setError(null);
    try {
      await (kind === 'accept' ? acceptLop(request.request_id) : withdrawLop(request.request_id));
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={compact ? 'flex flex-wrap items-center gap-2' : 'flex flex-wrap items-center gap-2 mt-2'}>
      <PrimaryButton className="btn--sm" disabled={!!busy} onClick={() => act('accept')} data-testid="lop-accept">
        {busy === 'accept' ? 'Saving…' : `Accept ${request.lop_days} LOP day(s)`}
      </PrimaryButton>
      <GhostButton className="btn--sm" disabled={!!busy || hours <= 0} onClick={() => act('withdraw')} data-testid="lop-withdraw">
        {busy === 'withdraw' ? 'Withdrawing…' : `Withdraw the ${request.lop_days} LOP day(s)`}
      </GhostButton>
      <span className="small muted">{hours > 0 ? `${hours} h left to decide` : 'Window closed'}</span>
      {error && <p className="error-msg w-full">{error}</p>}
    </div>
  );
}

const STATUS = {
  PENDING: ['Awaiting your decision', 'pill--warning'],
  CONFIRMED: ['Loss of pay', 'pill--danger'],
  WITHDRAWN: ['LOP withdrawn', 'pill--muted'],
};

/**
 * The employee's own loss of pay from approved advance leave (more days than the balance): what
 * came from the balance, what is LOP, and the 24-hour decision on new ones.
 */
export default function LossOfPayPanel({ items = [], onChange }) {
  if (!items.length) return null;
  const confirmed = items.filter((r) => r.lop_status === 'CONFIRMED').reduce((t, r) => t + Number(r.lop_days || 0), 0);
  const pending = items.filter((r) => r.lop_status === 'PENDING');

  return (
    <GlassCard className="mb-6" data-testid="lop-panel">
      <div className="panel-head">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-accent-text" />
          <h2 className="h2">Loss of pay</h2>
        </div>
        <span className="small muted">
          <b className="num">{confirmed}</b> day(s) loss of pay this leave year
        </span>
      </div>
      {pending.length > 0 && (
        <div className="alert alert--warning mb-3" role="alert">
          <AlertTriangle />
          <p>
            Leave beyond your balance was approved. The extra days are <b>loss of pay</b> (deducted from salary):
            accept them, or withdraw only those days within 24 hours. With no answer they are confirmed as loss of pay.
          </p>
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {items.map((r) => {
          const total = Number(r.deducted_days || 0);
          const lop = Number(r.lop_days || 0);
          const [label, pill] = STATUS[r.lop_status] || [r.lop_status, 'pill--muted'];
          return (
            <li key={r.request_id} className="flex flex-col gap-1 pb-3 border-b border-border last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="num">{r.start_date} → {r.end_date}</span>
                <span className="muted small">{r.LeaveType?.type_name}</span>
                <span className={`pill ${pill}`}>{label}</span>
              </div>
              <p className="small">
                {r.lop_status === 'WITHDRAWN'
                  ? <>LOP days withdrawn: the leave is <b className="num">{total}</b> day(s), all from your balance.</>
                  : <><b className="num">{total}</b> day(s): <b className="num">{total - lop}</b> from your balance, <b className="num">{lop}</b> loss of pay.</>}
              </p>
              <LopDecision request={r} onDone={onChange} />
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}
