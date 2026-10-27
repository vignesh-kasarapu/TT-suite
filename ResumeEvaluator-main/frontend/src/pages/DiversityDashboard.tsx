import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Legend,
} from 'recharts'
import { useAppStore } from '../store/useAppStore'
import { getDiversityAnalytics } from '../api/client'
import type { DisparateImpactData } from '../api/client'

const LEVEL_COLORS: Record<string, string> = {
  junior:    '#534AB7',
  mid:       '#1D9E75',
  senior:    '#EF9F27',
  executive: '#E24B4A',
  entry:     '#0891b2',
  unknown:   '#9ca3af',
}

function LevelBadge({ level }: { level: string }) {
  const color = LEVEL_COLORS[level] ?? '#9ca3af'
  return (
    <span
      className="text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize"
      style={{ background: color + '20', color, border: `1px solid ${color}50` }}
    >
      {level}
    </span>
  )
}

const FAIRNESS_LABELS: Record<string, string> = { gender_identity: 'Gender', ethnicity: 'Ethnicity' }

function FairnessSection({ data }: { data: DisparateImpactData }) {
  const label = FAIRNESS_LABELS[data.field] ?? data.field
  const declaredRows = data.rows.filter((r) => r.impact_ratio !== null)

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200">Disparate Impact — {label}</h2>
        {data.any_adverse_impact ? (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-danger-100 text-danger-800 border border-danger/50">
            ⚠ Adverse impact detected
          </span>
        ) : declaredRows.length > 0 ? (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-success-100 text-success-800 border border-success-300/50">
            Within 4/5ths rule
          </span>
        ) : null}
      </div>
      <p className="text-xs text-gray-400 mb-4">
        4/5ths rule: a group's shortlist rate should be at least 80% of the highest-passing group's rate
        {data.reference_group ? ` (reference: ${data.reference_group}, ${data.reference_rate.toFixed(1)}%)` : ''}.
      </p>
      {data.rows.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">No self-identification data available for this field yet.</p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 text-gray-500 dark:text-gray-400 font-semibold capitalize">{label}</th>
                <th className="text-right py-2 text-gray-500 dark:text-gray-400 font-semibold">Count</th>
                <th className="text-right py-2 text-gray-500 dark:text-gray-400 font-semibold">Shortlist Rate</th>
                <th className="text-right py-2 text-gray-500 dark:text-gray-400 font-semibold">Impact Ratio</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.group} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-1.5 text-gray-700 dark:text-gray-300 font-medium capitalize">{r.group}</td>
                  <td className="text-right py-1.5 text-gray-600 dark:text-gray-400">{r.count}</td>
                  <td className="text-right py-1.5 text-gray-600 dark:text-gray-400">{r.shortlist_rate.toFixed(1)}%</td>
                  <td className={`text-right py-1.5 font-semibold ${
                    r.impact_ratio === null ? 'text-gray-300 dark:text-gray-600'
                      : r.adverse_impact ? 'text-danger' : 'text-success'
                  }`}>
                    {r.impact_ratio === null ? '—' : r.impact_ratio.toFixed(2)}
                    {r.adverse_impact && ' ⚠'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function MetricCard({ title, value, sub, color }: { title: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{title}</p>
      <p className="text-2xl font-black mt-1" style={{ color: color ?? '#534AB7' }}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function DiversityDashboard() {
  const selectedJobRoleId = useAppStore((s) => s.selectedJobRoleId)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['diversity-analytics', selectedJobRoleId],
    queryFn: () => getDiversityAnalytics(selectedJobRoleId ?? undefined),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)] text-gray-400">
        Loading diversity analytics…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)] text-danger-800">
        Failed to load diversity analytics.
      </div>
    )
  }

  const levels = data.by_experience_level
  const radarData = levels.map((l) => ({
    level: l.level.charAt(0).toUpperCase() + l.level.slice(1),
    'Avg Score': l.avg_score,
    'Shortlist %': l.shortlist_rate,
  }))

  const funnelData = data.stage_progression.filter((s) => s.count > 0)

  const locationData = Object.entries(data.location_counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }))

  // Score distribution per level — flatten to histogram per level
  const avgByLevel = levels.map((l) => ({
    name: l.level,
    avg: l.avg_score,
    color: LEVEL_COLORS[l.level] ?? '#9ca3af',
  }))

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Diversity & Bias Audit</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Score distributions segmented by experience level to surface potential evaluation bias.
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard title="Total Candidates" value={data.total_candidates} color="#534AB7" />
        <MetricCard
          title="Experience Levels"
          value={levels.length}
          sub="distinct cohorts tracked"
          color="#1D9E75"
        />
        <MetricCard
          title="Highest Shortlist Rate"
          value={`${Math.max(...levels.map((l) => l.shortlist_rate), 0).toFixed(1)}%`}
          sub={levels.find((l) => l.shortlist_rate === Math.max(...levels.map((x) => x.shortlist_rate)))?.level}
          color="#EF9F27"
        />
        <MetricCard
          title="Score Spread"
          value={`${(Math.max(...levels.map((l) => l.avg_score), 0) - Math.min(...levels.map((l) => l.avg_score), 100)).toFixed(1)}`}
          sub="avg score range across levels"
          color="#E24B4A"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Average score by experience level */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-4">Avg Score by Experience Level</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={avgByLevel} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}`, 'Avg Score']} />
              <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                {avgByLevel.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Shortlist rate comparison — bias indicator */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">Shortlist Rate by Level</h2>
          <p className="text-xs text-gray-400 mb-4">
            Large gaps between levels may indicate scoring bias. Aim for similar rates across comparable cohorts.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={levels.map((l) => ({ name: l.level, rate: l.shortlist_rate }))} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Shortlist Rate']} />
              <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                {levels.map((l, i) => (
                  <Cell key={i} fill={LEVEL_COLORS[l.level] ?? '#9ca3af'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Radar chart */}
      {radarData.length >= 3 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-4">Multi-Metric Radar by Level</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="level" tick={{ fontSize: 11 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                <Radar name="Avg Score" dataKey="Avg Score" stroke="#534AB7" fill="#534AB7" fillOpacity={0.25} />
                <Radar name="Shortlist %" dataKey="Shortlist %" stroke="#1D9E75" fill="#1D9E75" fillOpacity={0.2} />
                <Legend />
              </RadarChart>
            </ResponsiveContainer>

            {/* Table */}
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 text-gray-500 dark:text-gray-400 font-semibold">Level</th>
                    <th className="text-right py-2 text-gray-500 dark:text-gray-400 font-semibold">Count</th>
                    <th className="text-right py-2 text-gray-500 dark:text-gray-400 font-semibold">Avg Score</th>
                    <th className="text-right py-2 text-gray-500 dark:text-gray-400 font-semibold">Shortlisted</th>
                    <th className="text-right py-2 text-gray-500 dark:text-gray-400 font-semibold">Hired</th>
                  </tr>
                </thead>
                <tbody>
                  {levels.map((l) => (
                    <tr key={l.level} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1.5"><LevelBadge level={l.level} /></td>
                      <td className="text-right py-1.5 text-gray-700 dark:text-gray-300 font-medium">{l.count}</td>
                      <td className="text-right py-1.5 font-bold" style={{ color: LEVEL_COLORS[l.level] ?? '#534AB7' }}>
                        {l.avg_score.toFixed(1)}
                      </td>
                      <td className="text-right py-1.5 text-gray-600 dark:text-gray-400">
                        {l.shortlisted} <span className="text-gray-400">({l.shortlist_rate.toFixed(0)}%)</span>
                      </td>
                      <td className="text-right py-1.5 text-success font-semibold">{l.hired}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline stage funnel */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-4">Pipeline Stage Distribution</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={funnelData} layout="vertical" margin={{ top: 0, right: 20, left: 60, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="label" type="category" tick={{ fontSize: 11 }} width={70} />
              <Tooltip />
              <Bar dataKey="count" fill="#534AB7" radius={[0, 4, 4, 0]}>
                {funnelData.map((entry, i) => {
                  const stageColorMap: Record<string, string> = {
                    Applied: '#9ca3af', Screening: '#534AB7', 'Coding Test': '#0891b2',
                    Interview: '#EF9F27', Offer: '#1D9E75', Hired: '#085041', Rejected: '#E24B4A',
                  }
                  return <Cell key={i} fill={stageColorMap[entry.label] ?? '#534AB7'} />
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Location distribution */}
        {locationData.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-4">Top Candidate Locations</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={locationData} layout="vertical" margin={{ top: 0, right: 20, left: 80, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={80} />
                <Tooltip />
                <Bar dataKey="count" fill="#1D9E75" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FairnessSection data={data.gender_fairness} />
        <FairnessSection data={data.ethnicity_fairness} />
      </div>

      <div className="bg-warning-100/60 border border-warning/40 rounded-xl p-4">
        <p className="text-sm font-semibold text-warning-800">About this dashboard</p>
        <p className="text-xs text-warning-800/80 mt-1 leading-relaxed">
          Scores are computed purely on skills, projects, and education — name, gender, and demographic data are never used
          in evaluation. The fairness tables above use voluntary EEO self-identification solely for post-hoc adverse-impact
          auditing (4/5ths rule), never as scoring input. If shortlist rates differ significantly across levels or declared
          groups with similar avg scores, this may indicate that downstream manual decisions are re-introducing bias.
          Use the blind-mode toggle in the Leaderboard for blinded initial reviews.
        </p>
      </div>
    </div>
  )
}
