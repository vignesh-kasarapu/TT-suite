import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getSystemStatus } from '../api/client'
import type { SystemStatus } from '../api/client'
import EmailIngestion from './EmailIngestion'

const STEPS = ['Overview', 'Admin & Users', 'LLM Provider', 'Email & Integrations', 'Security Keys', 'Done']

function StepBar({ current, onJump }: { current: number; onJump: (i: number) => void }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((label, i) => (
        <div key={i} className="flex items-center flex-1">
          <button onClick={() => onJump(i)} className="flex flex-col items-center shrink-0">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                i < current
                  ? 'bg-accent border-accent text-white'
                  : i === current
                  ? 'bg-white dark:bg-gray-800 border-accent text-accent'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-300 dark:text-gray-500'
              }`}
            >
              {i < current ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={`text-[11px] mt-1 font-medium text-center ${i === current ? 'text-accent dark:text-accent-300' : 'text-gray-400 dark:text-gray-500'}`}>
              {label}
            </span>
          </button>
          {i < STEPS.length - 1 && (
            <div className={`flex-1 h-0.5 mx-2 mb-4 ${i < current ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-700'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

function randomBase64Url(byteLen: number): string {
  const bytes = new Uint8Array(byteLen)
  window.crypto.getRandomValues(bytes)
  let binary = ''
  bytes.forEach((b) => { binary += String.fromCharCode(b) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_')
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{label}</label>
      <div className="flex gap-2">
        <code className="flex-1 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 overflow-x-auto whitespace-nowrap text-gray-700 dark:text-gray-300">
          {value}
        </code>
        <button
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
          className="text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shrink-0"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

function WarningCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-warning-50 dark:bg-warning-900 border border-warning rounded-xl p-4 text-sm text-warning-800 dark:text-warning-300">
      {children}
    </div>
  )
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-sm text-gray-600 dark:text-gray-300">{label}</span>
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ok ? 'bg-success-100 text-success-800' : 'bg-danger-100 text-danger-800'}`}>
        {ok ? 'Configured' : 'Not configured'}
      </span>
    </div>
  )
}

export default function SetupWizard() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const { data: status, refetch } = useQuery<SystemStatus>({ queryKey: ['system-status'], queryFn: getSystemStatus })

  const secretKey = useMemo(() => randomBase64Url(36), [])
  const panKey = useMemo(() => randomBase64Url(32), [])

  return (
    <div className="max-w-3xl">
      <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-1">Setup Wizard</h1>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">Guided first-run configuration.</p>

      <StepBar current={step} onJump={setStep} />

      {step === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-1">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">Configuration Overview</h2>
          {status && (
            <>
              <StatusRow label="LLM provider" ok={status.llm_configured} />
              <StatusRow label="Email delivery (SMTP)" ok={status.smtp_configured} />
              <StatusRow label="Inbound email (IMAP)" ok={status.imap_configured} />
              <StatusRow label="SharePoint / Graph integration" ok={status.sharepoint_configured} />
              <StatusRow label="Google OAuth" ok={status.google_oauth_configured} />
              <StatusRow label="GitHub enrichment token" ok={status.github_token_configured} />
              <StatusRow label="Secret key strength" ok={status.secret_key_secure} />
              <StatusRow label="Production-ready database" ok={status.database_production_ready} />
            </>
          )}
          <div className="pt-4">
            <button onClick={() => setStep(1)} className="bg-accent hover:bg-accent-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">
              Start Setup →
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Admin & Users</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            The initial admin account is created automatically at startup from the <code>ADMIN_EMAIL</code> /
            <code> ADMIN_PASSWORD</code> environment variables. Add teammates or change roles from User Management.
          </p>
          <button
            onClick={() => navigate('/settings/users')}
            className="text-sm text-accent hover:underline"
          >
            Open User Management →
          </button>
          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(0)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-4 py-2">← Back</button>
            <button onClick={() => setStep(2)} className="bg-accent hover:bg-accent-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">Next →</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">LLM Provider</h2>
          <StatusRow label="LLM provider" ok={!!status?.llm_configured} />
          {status?.llm_configured && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Currently using <span className="font-medium">{status.llm_provider}</span>
              {status.llm_model && <> (model <span className="font-medium">{status.llm_model}</span>)</>}.
            </p>
          )}
          <WarningCard>
            LLM credentials (<code>LLM_API_KEY</code>, <code>LLM_BASE_URL</code>, <code>LLM_MODEL</code>) are read once
            from environment variables at server startup — they can't be saved from this wizard. Set them in your
            <code> .env</code> file and restart the backend to change providers.
          </WarningCard>
          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(1)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-4 py-2">← Back</button>
            <button onClick={() => setStep(3)} className="bg-accent hover:bg-accent-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">Next →</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Email & Integrations</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              SMTP, inbound IMAP, SharePoint, OneDrive, and directory sync — configured and saved directly here.
            </p>
          </div>
          <EmailIngestion />
          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-4 py-2">← Back</button>
            <button onClick={() => setStep(4)} className="bg-accent hover:bg-accent-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">Next →</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Security Keys</h2>
          <StatusRow label="Secret key strength" ok={!!status?.secret_key_secure} />
          <WarningCard>
            These are suggested values only — nothing is saved automatically. Copy them into your <code>.env</code> file
            as <code>SECRET_KEY</code> and <code>PAN_ENCRYPTION_KEY</code>, then restart the backend for them to take effect.
          </WarningCard>
          <CopyField label="Suggested SECRET_KEY" value={secretKey} />
          <CopyField label="Suggested PAN_ENCRYPTION_KEY (Fernet)" value={panKey} />
          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(3)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-4 py-2">← Back</button>
            <button onClick={() => { refetch(); setStep(5) }} className="bg-accent hover:bg-accent-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">Finish →</button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-1">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">Setup Summary</h2>
          {status && (
            <>
              <StatusRow label="LLM provider" ok={status.llm_configured} />
              <StatusRow label="Email delivery (SMTP)" ok={status.smtp_configured} />
              <StatusRow label="Inbound email (IMAP)" ok={status.imap_configured} />
              <StatusRow label="SharePoint / Graph integration" ok={status.sharepoint_configured} />
              <StatusRow label="Google OAuth" ok={status.google_oauth_configured} />
              <StatusRow label="GitHub enrichment token" ok={status.github_token_configured} />
              <StatusRow label="Secret key strength" ok={status.secret_key_secure} />
              <StatusRow label="Production-ready database" ok={status.database_production_ready} />
            </>
          )}
          <div className="pt-4">
            <button onClick={() => navigate('/settings/general')} className="bg-accent hover:bg-accent-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
