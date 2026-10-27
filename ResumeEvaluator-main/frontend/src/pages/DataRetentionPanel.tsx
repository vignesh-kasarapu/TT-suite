import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getGdprSettings, updateGdprSettings, runRetention } from '../api/client'
import type { DataRetentionSettings, RetentionRunResult } from '../api/client'
import { useAppStore } from '../store/useAppStore'

function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`flex items-start gap-3 cursor-pointer select-none ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
      <div className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="sr-only"
        />
        <div className={`w-10 h-5 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-gray-300 dark:bg-gray-600'}`} />
        <div className={`pointer-events-none absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
      </div>
    </label>
  )
}

function ResultCard({ result }: { result: RetentionRunResult & { dry_run: boolean } }) {
  const isDryRun = result.dry_run
  return (
    <div className={`rounded-xl border p-4 space-y-2 ${isDryRun ? 'bg-warning-100/50 border-warning/40' : 'bg-success-100/40 border-success-300/40'}`}>
      <p className={`text-sm font-bold ${isDryRun ? 'text-warning-800' : 'text-success-800'}`}>
        {isDryRun ? 'Dry Run Results (no changes made)' : 'Retention Policy Executed'}
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="text-center">
          <p className="text-xl font-black text-accent">{result.candidates_processed}</p>
          <p className="text-[11px] text-gray-500">Candidates<br />processed</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-black text-warning">{result.candidates_anonymized}</p>
          <p className="text-[11px] text-gray-500">PII<br />anonymized</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-black text-danger">{result.candidates_deleted}</p>
          <p className="text-[11px] text-gray-500">Records<br />deleted</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-black text-success">{result.evaluations_deleted}</p>
          <p className="text-[11px] text-gray-500">Evaluations<br />deleted</p>
        </div>
      </div>
      {result.errors > 0 && (
        <p className="text-xs text-danger font-semibold">{result.errors} error(s) encountered.</p>
      )}
    </div>
  )
}

export default function DataRetentionPanel() {
  const role = useAppStore((s) => s.role)
  const isAdmin = role === 'admin'
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(false)
  const [dryRunResult, setDryRunResult] = useState<(RetentionRunResult & { dry_run: boolean }) | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data: settings, isLoading } = useQuery({
    queryKey: ['gdpr-settings'],
    queryFn: getGdprSettings,
    enabled: isAdmin,
  })

  const [local, setLocal] = useState<DataRetentionSettings | null>(null)
  const current: DataRetentionSettings = local ?? settings ?? {
    retention_enabled: false,
    retention_days: 180,
    retain_hired_forever: true,
    anonymize_on_delete: true,
    auto_delete_evaluations: false,
  }

  function set<K extends keyof DataRetentionSettings>(k: K, v: DataRetentionSettings[K]) {
    setLocal((prev) => ({ ...(prev ?? current), [k]: v }))
  }

  const saveMut = useMutation({
    mutationFn: () => updateGdprSettings(current),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gdpr-settings'] })
      setLocal(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
  })

  const dryRunMut = useMutation({
    mutationFn: () => runRetention(true),
    onSuccess: (res) => setDryRunResult({ ...res, dry_run: true }),
  })

  const executeMut = useMutation({
    mutationFn: () => runRetention(false),
    onSuccess: (res) => {
      setDryRunResult({ ...res, dry_run: false })
      setConfirmDelete(false)
      queryClient.invalidateQueries({ queryKey: ['results'] })
      queryClient.invalidateQueries({ queryKey: ['resumes'] })
    },
  })

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Data Retention & GDPR</h1>
        <div className="mt-4 bg-warning-50 border border-warning rounded-lg px-4 py-3 text-sm text-warning-800">
          Data retention settings are only visible to admins. Ask an admin if you need a change here.
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)] text-gray-400">
        Loading settings…
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Data Retention & GDPR</h1>
        <p className="text-sm text-gray-400 mt-1">
          Configure automatic PII cleanup to stay compliant with GDPR and other data protection regulations.
        </p>
      </div>

      {/* Master toggle */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 space-y-5">
        <Toggle
          label="Enable Data Retention Policy"
          description="When enabled, candidates who have not been hired and were created before the retention window will have their PII removed automatically."
          checked={current.retention_enabled}
          onChange={(v) => set('retention_enabled', v)}
        />

        {current.retention_enabled && (
          <>
            <hr className="border-gray-100 dark:border-gray-800" />

            {/* Retention days */}
            <div>
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-1">
                Retention Period (days)
              </label>
              <p className="text-xs text-gray-400 mb-2">
                Candidates created more than this many days ago will be eligible for cleanup.
              </p>
              <input
                type="number"
                min={30}
                max={3650}
                value={current.retention_days}
                onChange={(e) => set('retention_days', Math.max(30, Number(e.target.value)))}
                className="w-32 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              <span className="text-xs text-gray-400 ml-3">
                {(current.retention_days / 30).toFixed(1)} months
              </span>
            </div>

            <hr className="border-gray-100 dark:border-gray-800" />

            <div className="space-y-4">
              <Toggle
                label="Retain Hired Candidates Forever"
                description="Hired candidates are excluded from retention cleanup regardless of age."
                checked={current.retain_hired_forever}
                onChange={(v) => set('retain_hired_forever', v)}
              />
              <Toggle
                label="Anonymize Instead of Delete"
                description="Recommended: scrub name, email, phone, and social links from the record but keep evaluation scores for aggregate analytics."
                checked={current.anonymize_on_delete}
                onChange={(v) => set('anonymize_on_delete', v)}
              />
              <Toggle
                label="Also Delete Evaluation Records"
                description="When deleting (not anonymizing), remove the evaluation scores too. This prevents any retroactive re-identification."
                checked={current.auto_delete_evaluations}
                onChange={(v) => set('auto_delete_evaluations', v)}
                disabled={current.anonymize_on_delete}
              />
            </div>
          </>
        )}
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || !local}
          className="px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent-700 disabled:opacity-50 transition-colors"
        >
          {saveMut.isPending ? 'Saving…' : 'Save Settings'}
        </button>
        {saved && (
          <span className="text-sm text-success font-semibold flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Saved
          </span>
        )}
      </div>

      {/* Manual Run section */}
      {current.retention_enabled && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">Manual Run</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Run a dry-run first to see what would be affected, then execute for real.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => { setDryRunResult(null); dryRunMut.mutate() }}
              disabled={dryRunMut.isPending}
              className="px-4 py-2 rounded-xl border border-warning text-warning-800 bg-warning-100/60 hover:bg-warning-100 text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {dryRunMut.isPending ? 'Scanning…' : 'Run Dry Scan'}
            </button>

            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="px-4 py-2 rounded-xl border border-danger/40 text-danger-800 bg-danger-100/60 hover:bg-danger-100 text-sm font-semibold transition-colors"
              >
                Execute Now
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-danger font-semibold">This will modify data. Confirm?</span>
                <button
                  onClick={() => executeMut.mutate()}
                  disabled={executeMut.isPending}
                  className="px-3 py-1.5 rounded-lg bg-danger text-white text-xs font-bold hover:bg-[#c42424] disabled:opacity-50 transition-colors"
                >
                  {executeMut.isPending ? 'Running…' : 'Yes, execute'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {dryRunResult && <ResultCard result={dryRunResult} />}
        </div>
      )}

      {/* Disclaimer */}
      <div className="bg-accent-100/40 border border-accent-300/30 rounded-xl p-4">
        <p className="text-xs font-semibold text-accent-700 dark:text-accent-300">Compliance Note</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
          Enabling retention does not automatically run on a schedule in the current deployment.
          Set up a cron job to call <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">POST /admin/gdpr/run-retention?dry_run=false</code> with
          an admin bearer token at your desired frequency. All retention actions are recorded in the Audit Log.
        </p>
      </div>
    </div>
  )
}
