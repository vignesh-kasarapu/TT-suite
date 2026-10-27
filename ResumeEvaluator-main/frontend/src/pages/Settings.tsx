import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '../store/useAppStore'
import { getSystemStatus } from '../api/client'
import EmailIngestion from './EmailIngestion'
import Users from './Users'
import AuditLogs from './AuditLogs'
import DataRetentionPanel from './DataRetentionPanel'
import SetupWizard from './SetupWizard'

const TABS = [
  { key: 'general', label: 'General', path: 'general', adminOnly: false },
  { key: 'wizard', label: 'Setup Wizard', path: 'setup-wizard', adminOnly: true },
  { key: 'email', label: 'Email Ingestion', path: 'email', adminOnly: true },
  { key: 'users', label: 'User Management', path: 'users', adminOnly: true },
  { key: 'audit', label: 'Audit Logs', path: 'audit', adminOnly: true },
  { key: 'gdpr', label: 'Data Retention', path: 'gdpr', adminOnly: true },
]

function GeneralSettings() {
  const role = useAppStore((s) => s.role)
  const { data: status } = useQuery({ queryKey: ['system-status'], queryFn: getSystemStatus, enabled: role === 'admin' })

  const unconfiguredCount = status
    ? [status.smtp_configured, status.llm_configured, status.secret_key_secure, status.database_production_ready]
        .filter((v) => !v).length
    : 0

  return (
    <div className="space-y-4 max-w-2xl">
      {role === 'admin' && status && unconfiguredCount > 0 && (
        <div className="bg-warning-50 dark:bg-warning-900 border border-warning rounded-xl p-4 flex items-center justify-between gap-4">
          <p className="text-sm text-warning-800 dark:text-warning-300">
            {unconfiguredCount} setup {unconfiguredCount === 1 ? 'item needs' : 'items need'} attention.
          </p>
          <NavLink to="setup-wizard" className="text-sm font-medium text-accent hover:underline shrink-0">
            Open Setup Wizard →
          </NavLink>
        </div>
      )}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-6">
      <div>
        <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-0.5">General</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500">Appearance</p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Theme</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            One theme for every TT Suite app: the light/dark button in the top bar, or presets in your profile
          </p>
        </div>
        <a
          href="/profile#theme"
          className="flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-700 border border-accent-300/60 hover:border-accent rounded-lg px-3 py-1.5 transition-colors"
        >
          Open profile <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      </div>
    </div>
  )
}

export default function Settings() {
  const role = useAppStore((s) => s.role)
  const isAdmin = role === 'admin'
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin)

  return (
    <div className="flex gap-6 p-6 max-w-6xl mx-auto items-start">
      <aside className="w-52 shrink-0 space-y-1">
        <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100 px-3 mb-3">Settings</h1>
        {visibleTabs.map((t) => (
          <NavLink
            key={t.key}
            to={t.path}
            className={({ isActive }) =>
              `block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-accent-100 dark:bg-accent-900 text-accent dark:text-accent-300'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </aside>

      <div className="flex-1 min-w-0">
        <Routes>
          <Route index element={<Navigate to="general" replace />} />
          <Route path="general" element={<GeneralSettings />} />
          {isAdmin && <Route path="setup-wizard" element={<SetupWizard />} />}
          {isAdmin && <Route path="email" element={<EmailIngestion />} />}
          {isAdmin && <Route path="users" element={<Users />} />}
          {isAdmin && <Route path="audit" element={<AuditLogs />} />}
          {isAdmin && <Route path="gdpr" element={<DataRetentionPanel />} />}
          <Route path="*" element={<Navigate to="general" replace />} />
        </Routes>
      </div>
    </div>
  )
}
