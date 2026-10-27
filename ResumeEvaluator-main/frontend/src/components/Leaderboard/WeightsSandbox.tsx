import { useState, useCallback } from 'react'

export interface SandboxWeights {
  projects: number
  skills: number
  education: number
}

interface Props {
  defaultWeights: SandboxWeights
  onChange: (weights: SandboxWeights | null) => void
}

function clamp(n: number) { return Math.max(0, Math.min(100, Math.round(n))) }

export default function WeightsSandbox({ defaultWeights, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [weights, setWeights] = useState<SandboxWeights>(defaultWeights)
  const [active, setActive] = useState(false)

  const total = weights.projects + weights.skills + weights.education
  const balanced = total === 100

  const update = useCallback((key: keyof SandboxWeights, raw: number) => {
    const val = clamp(raw)
    const others = (['projects', 'skills', 'education'] as const).filter((k) => k !== key)
    const remaining = Math.max(0, 100 - val)
    const otherSum = weights[others[0]] + weights[others[1]]
    let a: number, b: number
    if (otherSum === 0) {
      a = Math.round(remaining / 2)
      b = remaining - a
    } else {
      a = clamp(Math.round((weights[others[0]] / otherSum) * remaining))
      b = remaining - a
    }
    const next = { ...weights, [key]: val, [others[0]]: a, [others[1]]: b }
    setWeights(next)
    if (active) onChange(next)
  }, [weights, active, onChange])

  function toggle() {
    const next = !active
    setActive(next)
    onChange(next ? weights : null)
  }

  function reset() {
    setWeights(defaultWeights)
    if (active) onChange(defaultWeights)
  }

  return (
    <div className="rounded-xl border border-accent-300/50 bg-accent-100/40 dark:bg-accent-900/40 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-accent-700 dark:text-accent-300 hover:bg-accent-100/60 dark:hover:bg-accent-900/60 transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          What-If Scoring Sandbox
          {active && (
            <span className="ml-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-accent text-white">Live</span>
          )}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-4 border-t border-accent-300/30">
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Drag sliders to rebalance scoring weights — the leaderboard re-ranks in real time without re-evaluating.
          </p>

          <div className="space-y-3">
            {(['projects', 'skills', 'education'] as const).map((key) => {
              const labels = { projects: 'Projects', skills: 'Skills', education: 'Education' }
              const colors = { projects: '#534AB7', skills: '#1D9E75', education: '#EF9F27' }
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{labels[key]}</span>
                    <span className="text-xs font-mono font-bold tabular-nums" style={{ color: colors[key] }}>
                      {weights[key]}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={weights[key]}
                    onChange={(e) => update(key, Number(e.target.value))}
                    style={{ accentColor: colors[key] }}
                    aria-label={`${labels[key]} weight`}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  />
                </div>
              )
            })}
          </div>

          {!balanced && (
            <p className="text-xs text-danger font-semibold">Weights must sum to 100 (currently {total})</p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={toggle}
              disabled={!balanced}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                active
                  ? 'bg-accent text-white border-accent hover:bg-accent-700'
                  : 'bg-white dark:bg-gray-800 text-accent border-accent/40 hover:bg-accent-100'
              }`}
            >
              {active ? 'Deactivate' : 'Activate Re-ranking'}
            </button>
            <button
              onClick={reset}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:underline"
            >
              Reset to role defaults
            </button>
            {active && balanced && (
              <span className="ml-auto text-[11px] text-accent dark:text-accent-300 font-semibold animate-pulse">
                ↕ Re-ranking active
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
