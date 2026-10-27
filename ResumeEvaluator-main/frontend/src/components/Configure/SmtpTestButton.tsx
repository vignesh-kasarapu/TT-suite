import { useState } from 'react'
import { testSmtpConnection } from '../../api/client'

export default function SmtpTestButton() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null)

  async function test() {
    setLoading(true)
    setResult(null)
    try {
      setResult(await testSmtpConnection())
    } catch {
      setResult({ ok: false, error: 'Request failed.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={test}
        disabled={loading}
        className="text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors text-gray-600 dark:text-gray-300"
      >
        {loading ? 'Sending…' : 'Send Test Email'}
      </button>
      {result && (
        <span className={`text-xs font-medium ${result.ok ? 'text-success' : 'text-danger'}`}>
          {result.ok ? result.message : result.error}
        </span>
      )}
    </div>
  )
}
