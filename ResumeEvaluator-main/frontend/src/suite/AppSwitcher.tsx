import { useEffect, useId, useRef, useState } from 'react';
import styles from './AppSwitcher.module.css';

export type SuiteApp = 'kanban' | 'lms' | 'expense' | 'ams' | 'resume';
/** The part of the portal's GET /api/me the switcher reads. */
export interface SuiteAccess {
  access?: Partial<Record<SuiteApp, string | null>>;
}

// TT Suite app switcher (suite contract §3.4): the same button, panel and glyphs in every suite
// app. The portal Dashboard, then each app the person can open (portal GET /api/me ->
// access[app] != null). Whole-page links - each app is its own SPA behind the portal gateway.
// Nothing renders until the portal has answered.
const GLYPHS = {
  apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  dashboard: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
  kanban: 'M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v13h-4z',
  lms: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  expense: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zm3 5h6M9 12h6M9 16h3',
  ams: 'M21 8 12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
  resume: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 15l2 2 4-4',
  check: 'M5 12l5 5L20 7',
} as const;

const APPS: { app: SuiteApp; href: string; label: string }[] = [
  { app: 'kanban', href: '/kanban/', label: 'Kanban' },
  { app: 'lms', href: '/lms/', label: 'Leave' },
  { app: 'expense', href: '/expense/', label: 'Expense' },
  { app: 'ams', href: '/ams/', label: 'Assets' },
  { app: 'resume', href: '/resume/', label: 'Resumes' },
];
const CURRENT: SuiteApp = 'resume';

function Glyph({ name, size }: { name: keyof typeof GLYPHS; size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeLinecap="round"
      style={{ flex: 'none', strokeWidth: 'var(--icon-stroke, 1.75)' }}
      aria-hidden="true"
      focusable="false"
    >
      <path d={GLYPHS[name]} />
    </svg>
  );
}

/** `me` is the portal's /api/me (SuiteHeaderControls fetches it); null until it has answered. */
export function AppSwitcher({ me }: { me: SuiteAccess | null }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const root = rootRef.current;
    const onDown = (e: PointerEvent) => {
      if (!root?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      const list = [...(root?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ?? [])];
      const i = list.indexOf(document.activeElement as HTMLAnchorElement);
      if (i < 0) return;
      let next = -1;
      if (e.key === 'ArrowDown') next = (i + 1) % list.length;
      else if (e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = list.length - 1;
      if (next < 0) return;
      e.preventDefault();
      list[next]?.focus();
    };
    const onFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && !root?.contains(to)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    root?.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      root?.removeEventListener('focusout', onFocusOut);
    };
  }, [open]);

  if (!me) return null;
  const apps = APPS.filter((a) => me.access?.[a.app] != null);

  return (
    <div ref={rootRef} className={styles.switcher} data-testid="app-switcher">
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-label="Switch app"
        title="Switch app"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        data-testid="app-switcher-open"
      >
        <Glyph name="apps" size={20} />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="TT Suite apps" className={styles.panel} data-testid="app-switcher-menu">
          <a href="/" role="menuitem" className={styles.item} onClick={() => setOpen(false)} data-testid="app-dashboard">
            <Glyph name="dashboard" size={18} />
            <span className={styles.label}>Dashboard</span>
          </a>
          {apps.map((a) => {
            const current = a.app === CURRENT;
            return (
              <a
                key={a.app}
                href={a.href}
                role="menuitem"
                className={styles.item}
                aria-current={current ? 'page' : undefined}
                onClick={() => setOpen(false)}
                data-testid={`app-${a.app}`}
              >
                <Glyph name={a.app} size={18} />
                <span className={styles.label}>{a.label}</span>
                {current && <Glyph name="check" size={16} />}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
