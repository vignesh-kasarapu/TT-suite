import { motion, AnimatePresence } from 'framer-motion'
import { NavLink, useLocation } from 'react-router-dom'
import NavBar, { allNavItems } from './NavBar'
import CommandPalette from './shared/CommandPalette'
import { useAppStore } from '../store/useAppStore'

interface LayoutProps {
  children: React.ReactNode
}

/**
 * TT Suite shell, the same as Kanban's: a 64px top bar over a 256px side nav (desktop) and the page.
 * Below 1024px the side nav becomes a 72px icon rail, so the page keeps its width.
 */
export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const role = useAppStore((s) => s.role)
  const items = allNavItems.filter((item) => !item.adminOnly || role === 'admin')

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-canvas font-sans">
      <CommandPalette />
      <NavBar />
      <div className="flex flex-1 min-h-0">
        <nav
          aria-label="Resume Evaluator"
          className="shrink-0 w-[72px] lg:w-64 p-2 lg:p-3 bg-surface border-r border-line overflow-y-auto flex flex-col gap-1"
        >
          {items.map(({ label, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              title={label}
              className={({ isActive }) =>
                `flex items-center justify-center lg:justify-start gap-3 rounded-suite px-3 py-2.5 text-[15px] lg:text-base transition-colors ${
                  isActive ? 'bg-accent/[0.12] font-medium' : 'hover:bg-accent/[0.06]'
                }`
              }
              style={({ isActive }) => ({ color: isActive ? 'var(--color-accent-text)' : 'var(--color-text-muted)' })}
            >
              <Icon className="w-5 h-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="sr-only lg:not-sr-only truncate">{label}</span>
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
