interface ScoreBarProps {
  score?: number
  value?: number
  label?: string
  color?: string
  showLabel?: boolean
}

function scoreToColor(score: number): string {
  if (score >= 75) return '#1D9E75'
  if (score >= 50) return '#EF9F27'
  return '#E24B4A'
}

export default function ScoreBar({ score, value, label, color, showLabel = true }: ScoreBarProps) {
  const actualScore = score ?? value ?? 0
  const clampedScore = Math.max(0, Math.min(100, actualScore))
  const barColor = color ?? scoreToColor(clampedScore)

  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between items-center text-[11px] mb-0.5 font-medium text-gray-500 dark:text-gray-400">
          <span>{label}</span>
          <span style={{ color: barColor }}>{Math.round(clampedScore)}%</span>
        </div>
      )}
      <div className="flex items-center gap-2 w-full">
        <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className="h-2 rounded-full transition-all duration-300"
            style={{ width: `${clampedScore}%`, backgroundColor: barColor }}
          />
        </div>
        {!label && showLabel && (
          <span className="text-xs font-semibold w-8 text-right" style={{ color: barColor }}>
            {Math.round(clampedScore)}
          </span>
        )}
      </div>
    </div>
  )
}
