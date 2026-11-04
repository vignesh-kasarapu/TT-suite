import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, Info, X } from 'lucide-react';

/** Short-lived messages, in the app's own styling.
 *
 *  The browser's `alert`/`prompt`/`confirm` boxes are the system's, not ours: they freeze the
 *  page, ignore the theme, cannot be styled and read badly on a phone. Everything that used
 *  to say something through one says it here instead, and anything that needs an answer asks
 *  for it in a Modal.
 *
 *      const toast = useToast();
 *      toast.success('Restriction called off.');
 *      toast.error(err.message);
 */
const ToastContext = createContext(null);

const ICONS = { success: Check, error: AlertTriangle, info: Info };
const LIFETIME_MS = { success: 4000, info: 5000, error: 8000 };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((all) => all.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message, tone = 'info') => {
      if (!message) return undefined;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((all) => [...all.slice(-3), { id, message: String(message), tone }]);
      timers.current.set(id, setTimeout(() => dismiss(id), LIFETIME_MS[tone] ?? LIFETIME_MS.info));
      return id;
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      show,
      dismiss,
      success: (message) => show(message, 'success'),
      error: (message) => show(message, 'error'),
      info: (message) => show(message, 'info'),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function Toaster({ toasts, onDismiss }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    // Bottom on a phone (within thumb reach, clear of the top bar), top-right from 640px up.
    <div className="toaster" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICONS[t.tone] || Info;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className={`toast toast--${t.tone}`}
              role={t.tone === 'error' ? 'alert' : 'status'}
              data-testid={`toast-${t.tone}`}
            >
              <span className="toast__ico" aria-hidden="true"><Icon className="w-4 h-4" /></span>
              <p className="toast__text">{t.message}</p>
              <button
                type="button"
                className="toast__close"
                onClick={() => onDismiss(t.id)}
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

export function useToast() {
  const api = useContext(ToastContext);
  if (api) return api;
  // A component rendered outside the provider (a test, a storybook page) should not crash
  // because it said something.
  return {
    show: () => undefined, dismiss: () => undefined,
    success: () => undefined, error: () => undefined, info: () => undefined,
  };
}
