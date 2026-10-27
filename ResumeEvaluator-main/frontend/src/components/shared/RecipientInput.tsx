import { useState, useRef } from 'react'
import type { EmployeeEmail } from '../../api/client'

export function displayName(s: EmployeeEmail): string {
  if (s.name) return s.name
  return s.email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

interface Props {
  label: string
  recipients: string[]
  onAdd: (email: string) => void
  onRemove: (email: string) => void
  suggestions: EmployeeEmail[]
}

export default function RecipientInput({ label, recipients, onAdd, onRemove, suggestions }: Props) {
  const [inputVal, setInputVal] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = inputVal.toLowerCase()
  const filtered = suggestions
    .filter(
      (s) =>
        !recipients.includes(s.email) &&
        (q.length === 0 ||
          s.email.toLowerCase().includes(q) ||
          displayName(s).toLowerCase().includes(q)),
    )
    .slice(0, 8)

  const addEmail = (email: string) => {
    const e = email.trim()
    if (e && !recipients.includes(e)) onAdd(e)
    setInputVal('')
    setShowDropdown(false)
  }

  return (
    <div className="relative">
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{label}</label>
      <div
        className="flex flex-wrap gap-1 min-h-[38px] border border-gray-200 dark:border-gray-600 dark:bg-gray-800 rounded-xl px-2 py-1.5 cursor-text focus-within:ring-2 focus-within:ring-accent/30"
        onClick={() => inputRef.current?.focus()}
      >
        {recipients.map((r) => (
          <span
            key={r}
            className="inline-flex items-center gap-1 bg-accent-100 dark:bg-accent-900 text-accent dark:text-[#a09edf] text-xs px-2 py-0.5 rounded-full"
          >
            {r}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(r) }}
              className="text-accent/60 hover:text-accent leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="flex-1 min-w-[120px] bg-transparent text-sm dark:text-gray-100 outline-none placeholder:text-gray-400"
          placeholder={recipients.length === 0 ? 'Type name or email…' : ''}
          value={inputVal}
          onChange={(e) => { setInputVal(e.target.value); setShowDropdown(true) }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',') && inputVal.trim()) {
              e.preventDefault()
              addEmail(inputVal)
            }
            if (e.key === 'Backspace' && !inputVal && recipients.length > 0) {
              onRemove(recipients[recipients.length - 1])
            }
          }}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          onFocus={() => setShowDropdown(true)}
        />
      </div>
      {showDropdown && filtered.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 mt-1 max-h-52 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg">
          {filtered.map((s) => (
            <li
              key={s.id}
              onMouseDown={() => addEmail(s.email)}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-accent-100/50 dark:hover:bg-accent-900/50 flex items-center gap-2"
            >
              <span className="font-medium text-gray-800 dark:text-gray-200">{displayName(s)}</span>
              <span className="text-gray-400 text-xs truncate">{s.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
