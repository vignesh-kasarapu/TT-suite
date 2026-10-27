import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { listUsers, requestRoleChange } from '../api/client'
import { useAppStore } from '../store/useAppStore'
import { useConfirm } from '../components/shared/ConfirmDialog'

type Role = 'recruiter' | 'admin'

/**
 * TT Suite: people and roles are managed centrally. A global admin adds people and gives them
 * recruiter or admin in the portal (Users & access); an admin here can only ask for a change,
 * which waits in the global admins' inbox.
 */
export default function Users() {
  const currentEmail = useAppStore((s) => s.user?.email)
  const confirm = useConfirm()
  const [rowMsg, setRowMsg] = useState<{ userId: number; type: 'success' | 'error'; text: string } | null>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['adminUsers'],
    queryFn: listUsers,
    staleTime: 0,
  })

  const requestMut = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: Role | null }) => requestRoleChange(userId, role),
    onSuccess: (data, { userId }) => {
      setRowMsg({ userId, type: 'success', text: data.message })
      setTimeout(() => setRowMsg(null), 4000)
    },
    onError: (err: any, { userId }) => {
      setRowMsg({ userId, type: 'error', text: err?.response?.data?.detail ?? 'Request failed.' })
      setTimeout(() => setRowMsg(null), 4000)
    },
  })

  async function ask(userId: number, email: string, role: Role | null) {
    const what = role ? `make ${email} ${role === 'admin' ? 'an admin' : 'a recruiter'}` : `remove access for ${email}`
    if (await confirm({ title: 'Request role change?', description: `Ask a global admin to ${what}?`, intent: role ? 'info' : 'danger' })) {
      requestMut.mutate({ userId, role })
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">People and roles</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Everyone signs in with their Microsoft account through the TT Suite. A global admin gives access to the
          Resume Evaluator (recruiter or admin) in{' '}
          <a href="/admin" className="text-accent hover:underline">Users &amp; access</a>; people appear here after
          their first visit. You can ask for a role change below.
        </p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">All Users</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">{users.length} total</span>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">Loading…</div>
        ) : users.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">No users found.</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Person</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Role</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Status</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">First visit</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 w-64 text-right">Request</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.email === currentEmail
                const busy = requestMut.isPending && requestMut.variables?.userId === u.id
                return (
                  <tr key={u.id} className={`border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 ${!u.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-5 py-3">
                      <div className="text-gray-800 dark:text-gray-100">{u.name || u.email}</div>
                      {u.name && <div className="text-xs text-gray-400 dark:text-gray-500">{u.email}</div>}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                        u.role === 'admin'
                          ? 'bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300 border-accent-300'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                        u.is_active
                          ? 'bg-success-100 text-success-800 border-success-300/40'
                          : 'bg-danger-100 text-danger-800 border-danger/30'
                      }`}>
                        {u.is_active ? 'Active' : 'No access'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-400 dark:text-gray-500">
                      {new Date(u.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {rowMsg?.userId === u.id ? (
                        <span className={`text-xs font-medium ${rowMsg.type === 'success' ? 'text-success-800' : 'text-danger-800'}`}>
                          {rowMsg.text}
                        </span>
                      ) : isSelf ? (
                        <span className="text-xs text-gray-300 dark:text-gray-600 italic">you</span>
                      ) : u.is_active ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => ask(u.id, u.email, u.role === 'admin' ? 'recruiter' : 'admin')}
                            disabled={busy}
                            className="text-xs font-medium text-accent hover:text-accent-700 border border-accent-300/60 hover:border-accent rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-40"
                          >
                            {u.role === 'admin' ? 'Make recruiter' : 'Make admin'}
                          </button>
                          <button
                            onClick={() => ask(u.id, u.email, null)}
                            disabled={busy}
                            className="text-xs font-medium text-danger border border-danger/50 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-40"
                          >
                            Remove access
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}
