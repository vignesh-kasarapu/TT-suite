import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LineChart, Line,
} from 'recharts'
import { getAnalytics } from '../api/client'
import type { SkillMatchRate } from '../api/client'
import { useAppStore } from '../store/useAppStore'


const HISTOGRAM_FILL = [
  '#E24B4A', '#E24B4A', '#EF9F27', '#EF9F27', '#EF9F27',
  '#1D9E75', '#1D9E75', '#1D9E75', '#534AB7', '#534AB7',
]

export default function Analytics() {
  const navigate = useNavigate()
  const selectedJobRoleId = useAppStore((s) => s.selectedJobRoleId)
  const [days, setDays] = useState(30)

  function drillDownToScore(range: string) {
    const [min, max] = range.split('-').map(Number)
    navigate(`/leaderboard?scoreMin=${min}&scoreMax=${max}`)
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics', selectedJobRoleId, days],
    queryFn: () => getAnalytics(selectedJobRoleId ?? undefined, days),
  })


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)] text-gray-400">
        Loading analytics…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)] text-danger-800">
        Failed to load analytics data.
      </div>
    )
  }

  const { section_averages: sa, status_counts: sc } = data

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Analytics</h1>
        <select
          className="border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-1.5 text-sm"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {data.total_evaluated === 0 && (
        <div className="bg-warning-100 border border-warning/30 rounded-xl p-6 text-center text-warning-800 text-sm">
          No evaluation data available. Run evaluations first.
        </div>
      )}

      {/* ── Summary Metric Cards ─────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {/* Total Evaluated */}
        <div className="rounded-xl border p-4" style={{ backgroundColor: '#EEEDFE', borderColor: '#534AB740' }}>
          <p className="text-xs font-medium mb-1" style={{ color: '#534AB7' }}>Total Evaluated</p>
          <p className="text-2xl font-bold" style={{ color: '#534AB7' }}>{data.total_evaluated}</p>
        </div>
        {/* Avg Score */}
        <div className="rounded-xl border p-4" style={{ backgroundColor: '#E1F5EE', borderColor: '#1D9E7540' }}>
          <p className="text-xs font-medium mb-1" style={{ color: '#1D9E75' }}>Avg Score</p>
          <p className="text-2xl font-bold" style={{ color: '#1D9E75' }}>{data.avg_score}</p>
        </div>
        {/* Shortlisted */}
        <div className="rounded-xl border p-4" style={{ backgroundColor: '#FAEEDA', borderColor: '#EF9F2740' }}>
          <p className="text-xs font-medium mb-1" style={{ color: '#EF9F27' }}>Shortlisted</p>
          <p className="text-2xl font-bold" style={{ color: '#EF9F27' }}>{sc.shortlisted ?? 0}</p>
        </div>
        {/* Next Consideration — mirrors leaderboard: needs_review + pending */}
        <div className="rounded-xl border p-4" style={{ backgroundColor: '#F5F3FF', borderColor: '#7C3AED40' }}>
          <p className="text-xs font-medium mb-1" style={{ color: '#7C3AED' }}>Next Consideration</p>
          <p className="text-2xl font-bold" style={{ color: '#7C3AED' }}>{data.needs_review_count + data.pending_count}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px]" style={{ color: '#7C3AED99' }}>Manual Review</span>
            <span className="text-[11px] font-semibold tabular-nums" style={{ color: '#7C3AED' }}>{data.needs_review_count}</span>
          </div>
        </div>
        {/* Rejected */}
        <div className="rounded-xl border p-4" style={{ backgroundColor: '#F3F4F6', borderColor: '#6B728040' }}>
          <p className="text-xs font-medium mb-1" style={{ color: '#6B7280' }}>Rejected</p>
          <p className="text-2xl font-bold" style={{ color: '#6B7280' }}>{sc.rejected ?? 0}</p>
        </div>
      </div>

      {/* ── Section Averages ─────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Avg Projects Score', value: sa.projects, color: '#534AB7' },
          { label: 'Avg Skills Score', value: sa.skills, color: '#1D9E75' },
          { label: 'Avg Education Score', value: sa.education, color: '#EF9F27' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{label}</p>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-2 rounded-full" style={{ width: `${value}%`, backgroundColor: color }} />
              </div>
              <span className="text-sm font-bold" style={{ color }}>{value}%</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Score Distribution ───────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-start justify-between mb-1">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Score Distribution</h2>
          <p className="text-xs text-gray-400 italic">Click a bar to view candidates in that range</p>
        </div>
        <p className="text-xs text-gray-400 mb-4">Candidates per 10-point score bucket</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart
            data={data.score_distribution}
            margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
            style={{ cursor: 'pointer' }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="range" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(val: number) => [val, 'Candidates']}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              cursor={{ fill: 'rgba(83,74,183,0.08)' }}
            />
            <Bar
              dataKey="count"
              radius={[4, 4, 0, 0]}
              onClick={(entry: { range: string }) => { if (entry.range) drillDownToScore(entry.range) }}
            >
              {data.score_distribution.map((_, idx) => (
                <Cell key={idx} fill={HISTOGRAM_FILL[idx]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Evaluations Over Time ────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Evaluations Over Time</h2>
        <p className="text-xs text-gray-400 mb-4">Daily submission count for the selected period</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data.evaluations_per_day} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(d) => d.slice(5)}
              interval={Math.floor(data.evaluations_per_day.length / 8)}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              labelFormatter={(l) => `Date: ${l}`}
            />
            <Line type="monotone" dataKey="count" stroke="#534AB7" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Per-Skill Match Rates ────────────────────────────── */}
      {data.skill_match_rates.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Skill Match Rates</h2>
          <p className="text-xs text-gray-400 mb-4">
            % of candidates who matched each required skill (sorted by weakest first)
          </p>
          <div className="space-y-2">
            {data.skill_match_rates.map((row: SkillMatchRate) => {
              const pct = Math.round(row.match_rate)
              const color = pct >= 75 ? '#1D9E75' : pct >= 50 ? '#EF9F27' : '#E24B4A'
              return (
                <div key={row.skill_name} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 dark:text-gray-300 w-40 truncate shrink-0">{row.skill_name}</span>
                  <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                  <span className="text-xs font-semibold w-10 text-right" style={{ color }}>{pct}%</span>
                  <span className="text-xs text-gray-400 w-16 text-right shrink-0">{row.matched_count}/{row.total}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Top Skill Gaps ───────────────────────────────────── */}
      {data.top_skill_gaps.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Top Skill Gaps</h2>
          <p className="text-xs text-gray-400 mb-3">Skills matched by fewer than 50% of candidates</p>
          <div className="flex flex-wrap gap-2">
            {data.top_skill_gaps.map((skill) => (
              <span key={skill} className="text-xs px-2.5 py-1 rounded-full border bg-danger-100 text-danger-800 border-danger">
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Hiring Stage Funnel (hidden) ────────────────────────────────────
      {data.stage_funnel && data.stage_funnel.some((s: StageFunnelItem) => s.count > 0) && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Hiring Stage Funnel</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
            Candidate distribution across each stage of the pipeline
          </p>
          <div className="space-y-2.5">
            {(() => {
              const maxCount = Math.max(...data.stage_funnel.map((s: StageFunnelItem) => s.count), 1)
              return data.stage_funnel.map((item: StageFunnelItem) => (
                <div key={item.stage} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 dark:text-gray-300 w-24 shrink-0">{item.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-5 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                      style={{
                        width: item.count === 0 ? '0%' : `${Math.max(4, (item.count / maxCount) * 100)}%`,
                        backgroundColor: STAGE_COLORS[item.stage] ?? '#9CA3AF',
                      }}
                    >
                      {item.count > 0 && (
                        <span className="text-[10px] font-bold text-white leading-none">{item.count}</span>
                      )}
                    </div>
                  </div>
                  {item.count === 0 && (
                    <span className="text-xs text-gray-300 dark:text-gray-600 w-4">0</span>
                  )}
                </div>
              ))
            })()}
          </div>
        </div>
      )} */}

      {/* ── Experience Level Breakdown (hidden) ─────────────────────────────
      {data.experience_level_counts && Object.keys(data.experience_level_counts).length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Experience Level Breakdown</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Distribution of candidates by seniority and average score per level</p>
          <div className="space-y-2.5">
            {(['junior', 'mid', 'senior', 'executive', 'unknown'] as const).map((lvl) => {
              const count = (data.experience_level_counts as Record<string, number>)[lvl] ?? 0
              if (count === 0) return null
              const maxCount = Math.max(...Object.values(data.experience_level_counts as Record<string, number>), 1)
              const avgScore = (data.avg_score_by_level as Record<string, number>)[lvl]
              const levelColors: Record<string, string> = {
                junior: '#3B82F6', mid: '#534AB7', senior: '#1D9E75', executive: '#EF9F27', unknown: '#9CA3AF',
              }
              return (
                <div key={lvl} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 dark:text-gray-300 w-20 shrink-0 capitalize">{lvl}</span>
                  <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-5 rounded-full flex items-center justify-end pr-2 transition-all duration-500"
                      style={{ width: `${Math.max(4, (count / maxCount) * 100)}%`, backgroundColor: levelColors[lvl] }}
                    >
                      <span className="text-[10px] font-bold text-white leading-none">{count}</span>
                    </div>
                  </div>
                  {avgScore != null && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 w-16 shrink-0 text-right">avg {avgScore}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )} */}

      {/* Score Calibration — hidden */}
    </div>
  )
}
