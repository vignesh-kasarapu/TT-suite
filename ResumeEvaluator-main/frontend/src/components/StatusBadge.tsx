type StatusType =
  | 'shortlisted'
  | 'review'
  | 'rejected'
  | 'hired'
  | 'pending'
  | 'parsing'
  | 'scoring'
  | 'done'
  | 'error'

interface StatusBadgeProps {
  status: StatusType
}

const statusConfig: Record<StatusType, { label: string; classes: string }> = {
  shortlisted: {
    label: 'Shortlisted',
    classes: 'bg-success-100 text-success-800 border-success-300',
  },
  review: {
    label: 'Needs Review',
    classes: 'bg-[#F5F3FF] text-[#5B21B6] border-[#7C3AED]',
  },
  rejected: {
    label: 'Rejected',
    classes: 'bg-danger-100 text-danger-800 border-danger',
  },
  hired: {
    label: 'Hired',
    classes: 'bg-success-100 text-success-800 border-success-300',
  },
  pending: {
    label: 'On Hold',
    classes: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600',
  },
  parsing: {
    label: 'Parsing',
    classes: 'bg-accent-100 text-accent-700 border-accent-300',
  },
  scoring: {
    label: 'Scoring',
    classes: 'bg-accent-100 text-accent border-accent-300',
  },
  done: {
    label: 'Done',
    classes: 'bg-gray-100 text-gray-600 border-gray-300',
  },
  error: {
    label: 'Error',
    classes: 'bg-danger-100 text-danger-800 border-danger',
  },
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.done
  return (
    <span
      className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full border ${config.classes}`}
    >
      {config.label}
    </span>
  )
}

