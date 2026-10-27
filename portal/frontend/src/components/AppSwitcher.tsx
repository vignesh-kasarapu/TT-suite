import { useEffect, useRef, useState } from 'react';
import type { AppKey, Me } from '../api';
import { Icon } from './Icon';
import s from '../styles/portal.module.css';

// The same switcher, items and glyphs in every suite app's top bar.
const ITEMS: { key: AppKey; label: string; href: string; icon: string }[] = [
  { key: 'kanban', label: 'Kanban', href: '/kanban/', icon: 'board' },
  { key: 'lms', label: 'Leave', href: '/lms/', icon: 'calendar' },
  { key: 'expense', label: 'Expense', href: '/expense/', icon: 'receipt' },
  { key: 'ams', label: 'Assets', href: '/ams/', icon: 'package' },
  { key: 'resume', label: 'Resumes', href: '/resume/', icon: 'filecheck' },
];

/** Dashboard plus the apps the person may open (full page loads). */
export function AppSwitcher({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={s.appMenu} ref={ref} data-testid="app-switcher">
      <button
        type="button"
        className={s.iconButton}
        aria-label="Switch app"
        title="Switch app"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid="app-switcher-open"
      >
        <Icon name="apps" size={20} />
      </button>
      {open ? (
        <nav className={s.appPanel} aria-label="Switch app">
          <a href="/" aria-current="page" data-testid="app-dashboard">
            <Icon name="home" size={18} />
            Dashboard
            <span className={s.appCurrent}><Icon name="check" size={16} /></span>
          </a>
          {ITEMS.filter((a) => me.access[a.key] != null).map((a) => (
            <a key={a.key} href={a.href} data-testid={`app-${a.key}`}>
              <Icon name={a.icon} size={18} />
              {a.label}
            </a>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
