import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getSharedReport } from '../api/client'

export default function SharedReportView() {
  const { token } = useParams<{ token: string }>()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['shared-report', token],
    queryFn: () => getSharedReport(token!),
    enabled: !!token,
    retry: false,
  })

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen text-gray-400">Loading report…</div>
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-2 text-gray-500">
        <p className="text-lg font-semibold">Report not found</p>
        <p className="text-sm">This share link is invalid or has been revoked.</p>
      </div>
    )
  }

  const { name, config, result, candidates } = data

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{name}</h1>
        <p className="text-sm text-gray-400">Shared report — read-only</p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
              {config.dimensions.map((d) => <th key={d} className="px-4 py-2 font-medium">{d}</th>)}
              {config.metrics.map((m) => <th key={m} className="px-4 py-2 font-medium">{m}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {result.rows.map((row, i) => (
              <tr key={i} className="text-gray-700 dark:text-gray-300">
                {config.dimensions.map((d) => <td key={d} className="px-4 py-2">{row.dimensions[d]}</td>)}
                {config.metrics.map((m) => <td key={m} className="px-4 py-2">{row.metrics[m]}</td>)}
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr><td className="px-4 py-6 text-center text-gray-400" colSpan={config.dimensions.length + config.metrics.length}>No data for this selection.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Candidates ({candidates.length})</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Stage</th>
              <th className="px-4 py-2 font-medium">Score</th>
              <th className="px-4 py-2 font-medium">Experience</th>
              <th className="px-4 py-2 font-medium">Evaluated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {candidates.map((c) => (
              <tr key={c.evaluation_id} className="text-gray-700 dark:text-gray-300">
                <td className="px-4 py-2 font-medium whitespace-nowrap">{c.candidate_name}</td>
                <td className="px-4 py-2 whitespace-nowrap">{c.job_role_title ?? '—'}</td>
                <td className="px-4 py-2 whitespace-nowrap">{c.stage}</td>
                <td className="px-4 py-2">{c.total_score.toFixed(1)}</td>
                <td className="px-4 py-2 whitespace-nowrap">{c.experience_level ?? '—'}</td>
                <td className="px-4 py-2 whitespace-nowrap">{c.evaluated_at ? c.evaluated_at.slice(0, 10) : '—'}</td>
              </tr>
            ))}
            {candidates.length === 0 && (
              <tr><td className="px-4 py-6 text-center text-gray-400" colSpan={6}>No candidates match this selection.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
