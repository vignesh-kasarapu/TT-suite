import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CurrentUser } from '../api/client'

export interface DetectedSection {
  label: string
  line_start: number
  line_end: number
  color: string
}

export interface QueuedFile {
  file: File
  candidateName: string
  candidateEmail: string
  progress: number
  stage: string
  status: 'parsing' | 'scoring' | 'done' | 'error'
  resumeId?: number
  sections?: DetectedSection[]
}

export interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
  duration?: number
}

interface AppState {
  /** From GET /auth/me: the TT Suite person's role here (given by a global admin in the portal). */
  role: CurrentUser['role'] | null
  user: { email: string; name: string; permissions: Record<string, boolean> } | null
  selectedJobRoleId: number | null
  /** What is on screen (html.dark), set by the suite theme (src/suite/theme-switch.ts). */
  darkMode: boolean
  uploadQueue: QueuedFile[]
  toasts: Toast[]
  showToast: (message: string, type?: Toast['type'], duration?: number) => void
  dismissToast: (id: string) => void
  setMe: (me: CurrentUser) => void
  clearMe: () => void
  setJobRole: (id: number) => void
  setUploadQueue: (queue: QueuedFile[] | ((prev: QueuedFile[]) => QueuedFile[])) => void
}

/** Persisted slice: only the selected job role. Who you are always comes from the suite. */
type PersistedState = Pick<AppState, 'selectedJobRoleId'>

const isDark = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

export const useAppStore = create<AppState>()(
  persist<AppState, [], [], PersistedState>(
    (set) => ({
      role: null,
      user: null,
      selectedJobRoleId: null,
      darkMode: isDark(),
      uploadQueue: [],
      toasts: [],

      showToast: (message: string, type: Toast['type'] = 'info', duration = 4000) => {
        const id = Math.random().toString(36).substring(2, 9)
        set((state: AppState) => ({
          toasts: [...state.toasts, { id, message, type, duration }],
        }))
        setTimeout(() => {
          set((state: AppState) => ({
            toasts: state.toasts.filter((t: Toast) => t.id !== id),
          }))
        }, duration)
      },

      dismissToast: (id: string) => {
        set((state: AppState) => ({
          toasts: state.toasts.filter((t: Toast) => t.id !== id),
        }))
      },

      setMe: (me: CurrentUser) => {
        set({ role: me.role, user: { email: me.email, name: me.name, permissions: me.permissions } })
      },

      clearMe: () => {
        set({ role: null, user: null })
      },

      setJobRole: (id: number) => {
        set({ selectedJobRoleId: id })
      },

      setUploadQueue: (queueOrFn: QueuedFile[] | ((prev: QueuedFile[]) => QueuedFile[])) => {
        set((state: AppState) => ({
          uploadQueue:
            typeof queueOrFn === 'function' ? queueOrFn(state.uploadQueue) : queueOrFn,
        }))
      },
    }),
    {
      name: 'resume-store',
      partialize: (state: AppState): PersistedState => ({ selectedJobRoleId: state.selectedJobRoleId }),
    }
  )
)

// Keep darkMode in step with the suite theme (the top-bar toggle, the OS in 'system' mode).
if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
  new MutationObserver(() => {
    if (useAppStore.getState().darkMode !== isDark()) useAppStore.setState({ darkMode: isDark() })
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
}
