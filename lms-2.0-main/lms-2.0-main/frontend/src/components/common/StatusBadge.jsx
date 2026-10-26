const STATE_META = {
  DRAFT: { label: 'Draft', pill: 'pill--muted' },
  PENDING_MANAGER: { label: 'Pending manager', pill: 'pill--accent' },
  PENDING_HR: { label: 'Pending HR', pill: 'pill--accent' },
  APPROVED: { label: 'Approved', pill: 'pill--success' },
  REJECTED: { label: 'Rejected', pill: 'pill--danger' },
  REJECTED_PENDING_WITHDRAWAL: { label: 'Rejected — withdrawal window', pill: 'pill--warning' },
  WITHDRAWN: { label: 'Withdrawn', pill: 'pill--muted' },
  LOP_APPLIED: { label: 'Loss of pay', pill: 'pill--warning' },
  CANCELLATION_REQUESTED: { label: 'Cancellation requested', pill: 'pill--accent' },
  CANCELLED: { label: 'Cancelled', pill: 'pill--muted' },
};

export default function StatusBadge({ state }) {
  const meta = STATE_META[state] || { label: state, pill: 'pill--muted' };
  return <span className={`pill ${meta.pill}`}>{meta.label}</span>;
}
