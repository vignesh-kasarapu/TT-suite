import { useEffect, useId, useRef, useState } from 'react';
import { LayoutGrid, Home, SquareKanban, CalendarDays, Receipt, Check } from 'lucide-react';
import { useSuite } from '../../context/SuiteContext';

// TT Suite app switcher (suite contract §3.4): the portal dashboard plus every suite app
// the person can open (GET /api/me -> access[app] non-null). Plain links — each app is
// its own SPA behind the portal gateway.
const APPS = [
  { key: 'dashboard', label: 'Dashboard', hint: 'TT Suite home', href: '/', icon: Home },
  { key: 'kanban', label: 'Kanban', hint: 'Boards & tasks', href: '/kanban/', icon: SquareKanban },
  { key: 'lms', label: 'Leave', hint: 'Leave management', href: '/lms/', icon: CalendarDays },
  { key: 'expense', label: 'Expense', hint: 'Claims & approvals', href: '/expense/', icon: Receipt },
];
const CURRENT = 'lms';

export default function AppSwitcher() {
  const { me } = useSuite();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    // Move focus into the menu so keyboard users land on the first app.
    wrapRef.current?.querySelector('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!me) return null; // portal unreachable / not signed in: nothing to switch to

  const apps = APPS.filter((app) => app.key === 'dashboard' || me.access?.[app.key]);

  const onMenuKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...wrapRef.current.querySelectorAll('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn btn--ghost btn--sm !px-2"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Switch app"
        title="Switch app"
      >
        <LayoutGrid className="w-5 h-5" strokeWidth={2} />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="TT Suite apps"
          onKeyDown={onMenuKey}
          className="panel panel--strong absolute right-0 mt-3 z-50 !p-2"
          style={{ width: 'min(18rem, calc(100vw - 2rem))' }}
        >
          <p className="small muted px-2 pt-1 pb-2">TT Suite</p>
          <ul className="space-y-1">
            {apps.map(({ key, label, hint, href, icon: Icon }) => {
              const current = key === CURRENT;
              return (
                <li key={key}>
                  <a
                    href={href}
                    role="menuitem"
                    aria-current={current ? 'page' : undefined}
                    onClick={(e) => {
                      if (current) {
                        e.preventDefault();
                        setOpen(false);
                      }
                    }}
                    className="flex items-center gap-3 rounded-md px-2 py-2 min-h-[44px] focus:outline-none focus-visible:ring-2"
                    style={{
                      background: current ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : undefined,
                      color: 'var(--color-text)',
                      '--tw-ring-color': 'var(--color-accent)',
                    }}
                  >
                    <span
                      className="grid place-items-center shrink-0"
                      style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: 'var(--color-tint-2)', color: 'var(--color-accent-text)' }}
                    >
                      <Icon className="w-5 h-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-sm">{label}</span>
                      <span className="block small muted truncate">{hint}</span>
                    </span>
                    {current && <Check className="w-4 h-4 shrink-0" style={{ color: 'var(--color-accent-text)' }} aria-hidden="true" />}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
