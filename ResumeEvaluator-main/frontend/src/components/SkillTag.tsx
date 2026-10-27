interface SkillTagProps {
  label: string
  onRemove?: () => void
  variant?: 'purple' | 'teal' | 'muted' | 'amber'
}

const variantClasses: Record<string, string> = {
  purple: 'bg-accent-100 text-accent-700 border-accent-300',
  teal: 'bg-success-100 text-success-800 border-success-300',
  muted: 'bg-gray-100 text-gray-600 border-gray-300',
  amber: 'bg-amber-50 text-amber-700 border-amber-300',
}

export default function SkillTag({ label, onRemove, variant = 'purple' }: SkillTagProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border select-none ${variantClasses[variant]}`}
    >
      {label}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 leading-none opacity-60 hover:opacity-100 transition-opacity focus:outline-none"
          aria-label={`Remove ${label}`}
          type="button"
        >
          ×
        </button>
      )}
    </span>
  )
}
