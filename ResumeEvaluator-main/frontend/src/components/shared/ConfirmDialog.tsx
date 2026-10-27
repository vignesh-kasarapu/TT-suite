/**
 * ConfirmDialog — drop-in replacement for the browser's confirm() dialog.
 *
 * Usage
 * -----
 * 1. Mount <ConfirmDialogMount /> once in App.tsx (already done).
 * 2. In any component:
 *
 *    const confirm = useConfirm()
 *    await confirm({ title: 'Delete?', description: 'This cannot be undone.' })
 *    // returns true if user clicked Confirm, false if they clicked Cancel / closed.
 */
import { createContext, useCallback, useContext, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, Info, Trash2, X } from 'lucide-react'
import { useEscapeKey } from '../../lib/hooks'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string
  description?: string
  /** Button label for the destructive/confirm action. Default: "Confirm" */
  confirmLabel?: string
  /** Button label for the cancel action. Default: "Cancel" */
  cancelLabel?: string
  /** Visual intent: 'danger' = red, 'warning' = amber, 'info' = brand purple */
  intent?: 'danger' | 'warning' | 'info'
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

interface DialogState {
  open: boolean
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ConfirmContext = createContext<ConfirmFn | null>(null)

// ─── Provider ────────────────────────────────────────────────────────────────

export function ConfirmDialogMount({ children }: { children?: React.ReactNode }) {
  const [state, setState] = useState<DialogState>({
    open: false,
    options: { title: '' },
    resolve: () => {},
  })

  const confirm: ConfirmFn = useCallback((options) => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, options, resolve })
    })
  }, [])

  function close(value: boolean) {
    state.resolve(value)
    setState((s) => ({ ...s, open: false }))
  }

  const { open, options } = state

  useEscapeKey(() => close(false), open)
  const intent = options.intent ?? 'danger'

  const intentStyles = {
    danger: {
      icon: <Trash2 className="w-5 h-5 text-red-500" />,
      iconBg: 'bg-red-100 dark:bg-red-900/30',
      confirmBtn:
        'bg-red-600 hover:bg-red-700 focus:ring-red-500 text-white',
    },
    warning: {
      icon: <AlertTriangle className="w-5 h-5 text-amber-500" />,
      iconBg: 'bg-amber-100 dark:bg-amber-900/30',
      confirmBtn:
        'bg-amber-500 hover:bg-amber-600 focus:ring-amber-400 text-white',
    },
    info: {
      icon: <Info className="w-5 h-5 text-accent" />,
      iconBg: 'bg-accent-100 dark:bg-accent-900',
      confirmBtn:
        'bg-accent hover:bg-[#433A9D] focus:ring-accent/50 text-white',
    },
  }[intent]

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm"
              onClick={() => close(false)}
            />

            {/* Dialog */}
            <motion.div
              key="dialog"
              initial={{ opacity: 0, scale: 0.95, y: -12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -12 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none"
            >
              <div
                className="pointer-events-auto w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="confirm-title"
                aria-describedby={options.description ? 'confirm-desc' : undefined}
              >
                {/* Header */}
                <div className="flex items-start gap-4 p-6 pb-4">
                  <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${intentStyles.iconBg}`}>
                    {intentStyles.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2
                      id="confirm-title"
                      className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-snug"
                    >
                      {options.title}
                    </h2>
                    {options.description && (
                      <p
                        id="confirm-desc"
                        className="mt-1 text-sm text-gray-500 dark:text-gray-400 leading-relaxed"
                      >
                        {options.description}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => close(false)}
                    className="shrink-0 p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    aria-label="Cancel"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2.5 px-6 py-4 bg-gray-50 dark:bg-gray-800/60 border-t border-gray-100 dark:border-gray-700">
                  <button
                    onClick={() => close(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-500"
                    autoFocus
                  >
                    {options.cancelLabel ?? 'Cancel'}
                  </button>
                  <button
                    onClick={() => close(true)}
                    className={`px-4 py-2 text-sm font-semibold rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 shadow-sm ${intentStyles.confirmBtn}`}
                  >
                    {options.confirmLabel ?? 'Confirm'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  )
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/** Returns an async confirm function. Must be used inside <ConfirmDialogMount />. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm must be used inside <ConfirmDialogMount />')
  }
  return ctx
}
