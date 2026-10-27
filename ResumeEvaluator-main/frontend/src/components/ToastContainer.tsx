import { useAppStore } from '../store/useAppStore'

export default function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts || [])
  const dismissToast = useAppStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => {
        const isError = toast.type === 'error'
        const isSuccess = toast.type === 'success'
        const isWarning = toast.type === 'warning'

        let icon = (
          <svg className="w-5 h-5 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
        if (isSuccess) {
          icon = (
            <svg className="w-5 h-5 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )
        } else if (isError) {
          icon = (
            <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )
        } else if (isWarning) {
          icon = (
            <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )
        }

        const bgClass = isSuccess
          ? 'bg-emerald-50/80 dark:bg-emerald-950/20 border-emerald-500/20 text-emerald-900 dark:text-emerald-300'
          : isError
          ? 'bg-red-50/80 dark:bg-red-950/20 border-red-500/20 text-red-900 dark:text-red-300'
          : isWarning
          ? 'bg-amber-50/80 dark:bg-amber-950/20 border-amber-500/20 text-amber-900 dark:text-amber-300'
          : 'bg-white/80 dark:bg-gray-900/80 border-gray-200/50 dark:border-gray-800 text-gray-800 dark:text-gray-200'

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-md transition-all duration-300 animate-[slide-in_0.3s_ease-out] ${bgClass}`}
            role="alert"
          >
            {icon}
            <div className="flex-1 text-xs font-semibold leading-relaxed break-words">
              {toast.message}
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors shrink-0"
              aria-label="Close"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}
