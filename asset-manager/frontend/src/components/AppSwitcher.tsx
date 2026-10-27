import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, Grid3x3, KanbanSquare, LayoutGrid, Package, Receipt } from 'lucide-react';

// TT Suite: the portal dashboard plus every suite app this person can open (portal GET /api/me ->
// access[app] non-null), like the other apps' switchers. Links are plain page loads: each app is
// its own single-page app behind the portal gateway.
type SuiteApp = 'lms' | 'expense' | 'kanban' | 'ams';
const APPS: { app: SuiteApp | null; href: string; label: string; hint: string; icon: typeof LayoutGrid }[] = [
  { app: null, href: '/', label: 'Dashboard', hint: 'All your apps', icon: LayoutGrid },
  { app: 'lms', href: '/lms/', label: 'Leave', hint: 'Leave & approvals', icon: CalendarDays },
  { app: 'expense', href: '/expense/', label: 'Expense', hint: 'Claims & approvals', icon: Receipt },
  { app: 'kanban', href: '/kanban/', label: 'Kanban', hint: 'Boards & time', icon: KanbanSquare },
  { app: 'ams', href: '/ams/', label: 'Assets', hint: 'Asset management', icon: Package },
];
const CURRENT: SuiteApp = 'ams';

export const AppSwitcher: React.FC = () => {
  const [open, setOpen] = useState(false);
  // The sidebar scrolls (and so clips overflow): the menu is placed against the window instead.
  const [at, setAt] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const [access, setAccess] = useState<Partial<Record<SuiteApp, string | null>> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || access) return;
    fetch('/api/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setAccess(me?.access ?? {}))
      .catch(() => setAccess({}));
  }, [open, access]);
  const apps = APPS.filter((a) => a.app === null || a.app === CURRENT || access?.[a.app]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        aria-label="Switch app"
        aria-expanded={open}
        aria-controls="tt-suite-apps"
        ref={button}
        onClick={() => {
          const r = button.current?.getBoundingClientRect();
          if (r) setAt({ top: r.bottom + 8, left: r.left });
          setOpen((v) => !v);
        }}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-blue-50 hover:text-blue-700 cursor-pointer"
      >
        <Grid3x3 className="w-4 h-4" />
      </button>
      {open && (
        <nav
          id="tt-suite-apps"
          aria-label="TT Suite apps"
          style={{ top: at.top, left: at.left }}
          className="fixed z-[100] w-60 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5"
        >
          {apps.map(({ app, href, label, hint, icon: Icon }) => {
            const current = app === CURRENT;
            return (
            <a
              key={href}
              href={href}
              aria-current={current ? 'page' : undefined}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
                current ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex flex-col">
                <span>{label}</span>
                <span className="text-xs text-slate-500 font-normal">{hint}</span>
              </span>
            </a>
            );
          })}
        </nav>
      )}
    </div>
  );
};
