import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { searchCandidates } from '../../api/client'
import { allNavItems } from '../NavBar'
import { useEscapeKey } from '../../lib/hooks'

interface PaletteItem {
  id: string
  label: string
  subtitle?: string
  onSelect: () => void
}

export default function CommandPalette() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setDebouncedQuery('')
    setActiveIndex(0)
  }, [])

  useEscapeKey(close, open)

  // Global Ctrl+K / Cmd+K listener — active on every page.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250)
    return () => clearTimeout(t)
  }, [query])

  const { data: candidateResults } = useQuery({
    queryKey: ['command-palette-candidates', debouncedQuery],
    queryFn: () => searchCandidates({ q: debouncedQuery, limit: 6 }),
    enabled: open && debouncedQuery.trim().length >= 2,
  })

  const items: PaletteItem[] = useMemo(() => {
    const q = query.trim().toLowerCase()

    const navItems: PaletteItem[] = allNavItems
      .filter((n) => !q || n.label.toLowerCase().includes(q))
      .map((n) => ({
        id: `nav:${n.path}`,
        label: n.label,
        subtitle: n.path,
        onSelect: () => navigate(n.path),
      }))

    const candidateItems: PaletteItem[] = (candidateResults?.items ?? [])
      .filter((c) => c.latest_evaluation_id != null)
      .map((c) => ({
        id: `candidate:${c.id}`,
        label: c.name,
        subtitle: c.email ?? c.current_title ?? 'Candidate',
        onSelect: () => navigate(`/results/${c.latest_evaluation_id}`),
      }))

    return q.length >= 2 ? [...candidateItems, ...navItems] : navItems
  }, [query, candidateResults, navigate])

  useEffect(() => setActiveIndex(0), [items.length, query])

  function activate(item: PaletteItem) {
    item.onSelect()
    close()
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[999999] flex items-start justify-center bg-gray-900/60 backdrop-blur-md px-4 pt-[12vh]"
      onClick={close}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActiveIndex((i) => Math.min(i + 1, items.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActiveIndex((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const item = items[activeIndex]
                if (item) activate(item)
              }
            }}
            placeholder="Search candidates or jump to a page…"
            className="flex-1 bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400"
          />
          <kbd className="text-[10px] text-gray-400 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-1.5">
          {items.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8">No matches</p>
          )}
          {items.map((item, i) => (
            <button
              key={item.id}
              onClick={() => activate(item)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${
                i === activeIndex ? 'bg-accent-100 dark:bg-accent-900' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{item.label}</span>
              {item.subtitle && (
                <span className="text-xs text-gray-400 dark:text-gray-500 truncate shrink-0 max-w-[45%]">{item.subtitle}</span>
              )}
            </button>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 flex items-center gap-3 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><kbd className="border border-gray-200 dark:border-gray-600 rounded px-1">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="border border-gray-200 dark:border-gray-600 rounded px-1">Enter</kbd> select</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
