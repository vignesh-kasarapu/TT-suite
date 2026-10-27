import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useConfirm } from '../shared/ConfirmDialog'
import {
  getDirectorySyncSettings,
  saveDirectorySyncSettings,
  triggerDirectorySync,
  clearDirectoryEmployees,
  type DirectorySyncSettings,
} from '../../api/client'

const inputCls =
  'w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40'

export default function DirectorySyncPanel() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { data, isLoading } = useQuery<DirectorySyncSettings>({
    queryKey: ['directorySyncSettings'],
    queryFn: getDirectorySyncSettings,
  })

  const [source, setSource] = useState<'azure_ad' | 'ldap'>('azure_ad')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(389)
  const [useSsl, setUseSsl] = useState(false)
  const [bindDn, setBindDn] = useState('')
  const [bindPassword, setBindPassword] = useState('')
  const [baseDn, setBaseDn] = useState('')
  const [userFilter, setUserFilter] = useState('(&(objectClass=person)(mail=*))')
  const [emailAttr, setEmailAttr] = useState('mail')
  const [nameAttr, setNameAttr] = useState('displayName')
  const [titleAttr, setTitleAttr] = useState('title')
  const [deptAttr, setDeptAttr] = useState('department')
  const [loaded, setLoaded] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  useEffect(() => {
    if (data && !loaded) {
      setSource(data.directory_sync_source)
      setHost(data.ldap_host)
      setPort(data.ldap_port)
      setUseSsl(data.ldap_use_ssl)
      setBindDn(data.ldap_bind_dn)
      setBaseDn(data.ldap_base_dn)
      setUserFilter(data.ldap_user_filter || '(&(objectClass=person)(mail=*))')
      setEmailAttr(data.ldap_email_attr || 'mail')
      setNameAttr(data.ldap_name_attr || 'displayName')
      setTitleAttr(data.ldap_title_attr || 'title')
      setDeptAttr(data.ldap_dept_attr || 'department')
      setLoaded(true)
    }
  }, [data, loaded])

  const saveMut = useMutation({
    mutationFn: () => saveDirectorySyncSettings({
      directory_sync_source: source,
      ldap_host: host,
      ldap_port: port,
      ldap_use_ssl: useSsl,
      ldap_bind_dn: bindDn,
      ldap_bind_password: bindPassword || undefined,
      ldap_base_dn: baseDn,
      ldap_user_filter: userFilter,
      ldap_email_attr: emailAttr,
      ldap_name_attr: nameAttr,
      ldap_title_attr: titleAttr,
      ldap_dept_attr: deptAttr,
    } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['directorySyncSettings'] })
      setSaveMsg('Settings saved')
      setTimeout(() => setSaveMsg(null), 2500)
    },
    onError: (err: any) => setSaveMsg(err?.response?.data?.detail ?? 'Save failed'),
  })

  const syncMut = useMutation({
    mutationFn: triggerDirectorySync,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['directorySyncSettings'] })
      qc.invalidateQueries({ queryKey: ['employeeEmails'] })
      setSyncMsg(`Synced ${res.synced} employees from ${res.source === 'azure_ad' ? 'Azure AD' : 'LDAP'}`)
      setTimeout(() => setSyncMsg(null), 5000)
    },
    onError: (err: any) => setSyncMsg(err?.response?.data?.detail ?? 'Sync failed'),
  })

  const clearMut = useMutation({
    mutationFn: clearDirectoryEmployees,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['directorySyncSettings'] })
      qc.invalidateQueries({ queryKey: ['employeeEmails'] })
      setSyncMsg('Cleared all synced employees')
      setTimeout(() => setSyncMsg(null), 2500)
    },
  })

  if (isLoading) return null

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">Directory Sync</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            Sync employees from Azure AD or LDAP for CC/BCC autocomplete
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && data.employee_count > 0 && (
            <span className="text-xs font-semibold px-3 py-1 rounded-full border bg-success-100 text-success-800 border-success-300">
              {data.employee_count} synced
            </span>
          )}
        </div>
      </div>

      {/* Source selector */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block font-medium">Sync Source</label>
        <div className="grid grid-cols-2 gap-3">
          {([
            { value: 'azure_ad', label: 'Azure AD (Microsoft 365)', desc: 'Reuses Graph API credentials', icon: '☁️' },
            { value: 'ldap', label: 'LDAP / On-Premise AD', desc: 'Connect to your LDAP server', icon: '🗄️' },
          ] as const).map(({ value, label, desc, icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setSource(value)}
              className={`flex flex-col items-start gap-1 rounded-xl border-2 px-4 py-3 text-left transition-all ${
                source === value
                  ? 'border-accent bg-accent-100/30 dark:bg-accent-900/30'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <span className="text-lg">{icon}</span>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{label}</span>
              <span className="text-[11px] text-gray-400 dark:text-gray-500">{desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Azure AD info */}
      {source === 'azure_ad' && (
        <div className="space-y-2">
          <div className={`rounded-lg px-4 py-3 text-xs border ${
            data?.graph_configured
              ? 'bg-success-100/50 border-success-300 text-success-800 dark:text-success-300'
              : 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
          }`}>
            {data?.graph_configured
              ? '✓ Graph API credentials configured. Uses the same App Registration as email ingestion.'
              : '⚠ Microsoft Graph API credentials not configured. Set them in the "Microsoft Graph API Sync" panel above first.'}
          </div>
          <div className="rounded-lg px-4 py-3 text-xs border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 space-y-1">
            <p className="font-semibold">Required Azure AD permission: <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded font-mono">User.Read.All</code></p>
            <p>1. <strong>portal.azure.com</strong> → App registrations → your app</p>
            <p>2. API permissions → Add a permission → Microsoft Graph → <strong>Application permissions</strong></p>
            <p>3. Search <code className="font-mono bg-blue-100 dark:bg-blue-900 px-1 rounded">User.Read.All</code> → check it → Add permissions</p>
            <p>4. Click <strong>Grant admin consent for [tenant]</strong></p>
          </div>
        </div>
      )}

      {/* LDAP config */}
      {source === 'ldap' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">LDAP Host</label>
              <input className={inputCls} value={host} onChange={(e) => setHost(e.target.value)} placeholder="ldap.yourdomain.com" />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Port</label>
              <input type="number" className={inputCls} value={port} onChange={(e) => setPort(Number(e.target.value))} placeholder="389" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
            <input type="checkbox" checked={useSsl} onChange={(e) => setUseSsl(e.target.checked)}
              className="rounded border-gray-300 text-accent focus:ring-accent/30" />
            Use SSL/TLS (LDAPS — typically port 636)
          </label>

          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Bind DN</label>
            <input className={inputCls} value={bindDn} onChange={(e) => setBindDn(e.target.value)}
              placeholder="CN=svc-account,DC=yourdomain,DC=com" />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
              Bind Password{data?.ldap_bind_password_set && (
                <span className="ml-1 text-success font-normal">(set — leave blank to keep)</span>
              )}
            </label>
            <input type="password" className={inputCls} value={bindPassword} onChange={(e) => setBindPassword(e.target.value)}
              placeholder={data?.ldap_bind_password_set ? '••••••••' : 'Bind password'} autoComplete="new-password" />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Base DN</label>
            <input className={inputCls} value={baseDn} onChange={(e) => setBaseDn(e.target.value)}
              placeholder="DC=yourdomain,DC=com" />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">User Filter</label>
            <input className={inputCls} value={userFilter} onChange={(e) => setUserFilter(e.target.value)}
              placeholder="(&(objectClass=person)(mail=*))" />
          </div>

          {/* Attribute mappings */}
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Attribute Mappings</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Email attr', val: emailAttr, set: setEmailAttr, ph: 'mail' },
                { label: 'Name attr', val: nameAttr, set: setNameAttr, ph: 'displayName' },
                { label: 'Title attr', val: titleAttr, set: setTitleAttr, ph: 'title' },
                { label: 'Dept attr', val: deptAttr, set: setDeptAttr, ph: 'department' },
              ].map(({ label, val, set, ph }) => (
                <div key={label}>
                  <label className="text-[11px] text-gray-400 dark:text-gray-500 mb-0.5 block">{label}</label>
                  <input className={inputCls} value={val} onChange={(e) => set(e.target.value)} placeholder={ph} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Last sync status */}
      {data?.last_synced_at && (
        <div className="text-xs text-gray-400 dark:text-gray-500">
          Last sync: <span className="text-gray-600 dark:text-gray-300">{new Date(data.last_synced_at).toLocaleString()}</span>
          {' · '}<span className="text-gray-600 dark:text-gray-300">{data.last_synced_count} employees</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="bg-accent hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-2 transition-colors"
        >
          {saveMut.isPending ? 'Saving…' : 'Save Settings'}
        </button>
        <button
          onClick={() => syncMut.mutate()}
          disabled={syncMut.isPending || (source === 'azure_ad' && !data?.graph_configured)}
          className="border border-accent/40 text-accent dark:text-accent-300 hover:bg-accent-100 dark:hover:bg-accent-900 disabled:opacity-50 text-sm font-semibold rounded-lg px-4 py-2 transition-colors flex items-center gap-2"
        >
          {syncMut.isPending ? (
            <>
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Syncing…
            </>
          ) : 'Sync Now'}
        </button>
        {data && data.employee_count > 0 && (
          <button
            onClick={async () => {
              if (await confirm({
                title: 'Clear Employees?',
                description: 'Remove all synced employees?',
                intent: 'danger'
              })) clearMut.mutate()
            }}
            disabled={clearMut.isPending}
            className="border border-red-200 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm rounded-lg px-4 py-2 disabled:opacity-50 transition-colors"
          >
            Clear All
          </button>
        )}
        {(saveMsg || syncMsg) && (
          <span className={`text-xs font-medium ${(saveMsg || syncMsg)?.includes('failed') || (saveMsg || syncMsg)?.includes('Failed') ? 'text-red-500' : 'text-success'}`}>
            {saveMsg || syncMsg}
          </span>
        )}
      </div>
    </div>
  )
}
