import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../store/useAppStore'
import { getNotifications, getUnreadNotificationCount, markAllNotificationsRead, markNotificationRead } from '../api/client'
import { useEscapeKey, useAnchoredPanel } from '../lib/hooks'
import LogoDark from '../assets/Tektalis_Logo_Dark.svg'
import { BarChart3, Bell, Briefcase, FileText, KanbanSquare, LayoutDashboard, Settings, Trophy, Upload, Users } from 'lucide-react'
import { AppSwitcher } from '../suite/AppSwitcher'
import { SuiteHeaderControls } from '../suite/SuiteHeaderControls'

// The side nav (Layout) and the command palette list these.
export const allNavItems = [
  { label: 'Dashboard', path: '/dashboard', adminOnly: false, icon: LayoutDashboard },
  { label: 'Job Roles', path: '/configure', adminOnly: false, icon: Briefcase },
  { label: 'Leaderboard', path: '/leaderboard', adminOnly: false, icon: Trophy },
  { label: 'Pipeline', path: '/kanban', adminOnly: false, icon: KanbanSquare },
  { label: 'Analytics', path: '/analytics', adminOnly: false, icon: BarChart3 },
  { label: 'Diversity', path: '/diversity', adminOnly: false, icon: Users },
  { label: 'Reports', path: '/reports', adminOnly: false, icon: FileText },
  { label: 'Uploads', path: '/upload', adminOnly: false, icon: Upload },
  { label: 'Settings', path: '/settings', adminOnly: false, icon: Settings },
]


export default function NavBar() {
  const navigate = useNavigate()
  const { user, clearMe } = useAppStore()
  // The portal's /api/me (from SuiteHeaderControls): the app switcher lists the apps it grants.
  const [suiteMe, setSuiteMe] = useState<{ access?: Partial<Record<'kanban' | 'lms' | 'expense' | 'ams' | 'resume', string | null>> } | null>(null)
  const queryClient = useQueryClient()

  // ── Notification bell dropdown ──────────────────────────────
  const [notifOpen, setNotifOpen] = useState(false)
  const notifTriggerRef = useRef<HTMLDivElement>(null)
  const notifPanelRef = useRef<HTMLDivElement>(null)
  const notifPos = useAnchoredPanel(notifOpen, notifTriggerRef)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (
        notifTriggerRef.current && !notifTriggerRef.current.contains(target) &&
        (!notifPanelRef.current || !notifPanelRef.current.contains(target))
      ) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEscapeKey(() => setNotifOpen(false), notifOpen)

  const unreadCountQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: getUnreadNotificationCount,
    refetchInterval: 30000,
  })

  const notificationsQuery = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => getNotifications({ page_size: 10 }),
    enabled: notifOpen,
  })

  const markReadMut = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const markAllReadMut = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  function handleNotificationClick(notification: { id: number; read_at: string | null; link: string | null }) {
    if (!notification.read_at) markReadMut.mutate(notification.id)
    setNotifOpen(false)
    if (notification.link) navigate(notification.link)
  }

  return (
    <>
      {/* TT Suite top bar (Kanban's): exactly 64px, a surface band with a hairline under it. */}
      <header className="h-16 min-h-16 flex items-center justify-between gap-4 px-6 bg-surface border-b border-line shrink-0 z-40">
        <div className="flex items-center gap-3 min-w-0">
          {/* Kanban's brand: the charcoal wordmark, on a light pill in dark mode (--color-brand-backing). */}
          <a href="/" data-testid="brand-home" title="TT Suite dashboard"
            className="flex items-center select-none shrink-0 rounded-suite px-2 py-[5px] -mx-2 -my-[5px]"
            style={{ background: 'var(--color-brand-backing)' }}>
            <img src={LogoDark} alt="Tektalis" className="h-[26px] w-auto" />
          </a>
          <span aria-hidden="true" className="h-6 w-px bg-line shrink-0" />
          <span data-testid="app-name" className="text-base font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
            Resume Evaluator
          </span>
        </div>

        <div className="flex items-center gap-2">
          <AppSwitcher me={suiteMe} />

          {/* This app's notifications */}
          <div className="relative" ref={notifTriggerRef}>
            <button
              onClick={() => setNotifOpen((o) => !o)}
              className="relative flex items-center justify-center w-9 h-9 rounded-suite transition-colors hover:bg-accent-100 dark:hover:bg-accent-900/40"
              style={{ color: 'var(--color-text-muted)' }}
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" strokeWidth={1.75} />
              {!!unreadCountQuery.data && unreadCountQuery.data > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-danger rounded-full">
                  {unreadCountQuery.data > 9 ? '9+' : unreadCountQuery.data}
                </span>
              )}
            </button>

            {notifOpen && notifPos && createPortal(
              <div
                ref={notifPanelRef}
                style={{ top: notifPos.top, right: notifPos.right }}
                className="fixed w-80 max-h-96 overflow-y-auto glass-panel rounded-xl py-1 z-[999]"
              >
                <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Notifications</span>
                  <button
                    onClick={() => markAllReadMut.mutate()}
                    className="text-xs text-accent hover:underline"
                  >
                    Mark all read
                  </button>
                </div>
                {notificationsQuery.isLoading ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-400">Loading…</div>
                ) : !notificationsQuery.data?.items.length ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-400">No notifications yet</div>
                ) : (
                  notificationsQuery.data.items.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 ${
                        n.read_at ? 'text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-gray-100 font-medium'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {!n.read_at && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                        <div className="min-w-0">
                          <div className="truncate">{n.title}</div>
                          {n.body && <div className="text-xs text-gray-400 truncate">{n.body}</div>}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>,
              document.body
            )}
          </div>

          <SuiteHeaderControls
            name={user?.name ?? user?.email ?? ''}
            onSignOut={clearMe}
            onPortalMe={setSuiteMe}
          />
        </div>
      </header>

    </>
  )
}
