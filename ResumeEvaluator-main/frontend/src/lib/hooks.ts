import { useEffect, useState, useLayoutEffect } from 'react'

/** Calls `onEscape` when Escape is pressed while `active` is true. */
export function useEscapeKey(onEscape: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onEscape()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}

/** Returns `value`, updated only after it stops changing for `delayMs`. */
export function useDebounce<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

/** Tracks the viewport position of `triggerRef` while `open`, for a portaled dropdown. */
export function useAnchoredPanel(open: boolean, triggerRef: React.RefObject<HTMLElement>) {
  const [pos, setPos] = useState<{ top: number; right: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null)
      return
    }
    function update() {
      const rect = triggerRef.current!.getBoundingClientRect()
      setPos({ 
        top: rect.bottom + 8, 
        right: window.innerWidth - rect.right,
        left: rect.left 
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, triggerRef])

  return pos
}
