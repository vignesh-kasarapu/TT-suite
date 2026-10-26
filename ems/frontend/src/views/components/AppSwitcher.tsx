// TT Suite app switcher (top bar): the Dashboard plus every suite app the person can open (portal GET /api/me access).
// A disclosure button with a small menu of links; Escape or a click outside closes it.
import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "../../controllers/useAuth";
import type { SuiteApp } from "../../models/types";
import { Icon, type IconName } from "./Icon";

const APPS: { app: SuiteApp | null; href: string; label: string; icon: IconName }[] = [
  { app: null, href: "/", label: "Dashboard", icon: "dashboard" },
  { app: "kanban", href: "/kanban/", label: "Kanban", icon: "grid" },
  { app: "lms", href: "/lms/", label: "Leave", icon: "clock" },
  { app: "expense", href: "/expense/", label: "Expense", icon: "receipt" },
];
const CURRENT: SuiteApp = "expense";

export function AppSwitcher() {
  const { suite } = useAuth();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!suite) return null;
  const apps = APPS.filter((a) => a.app === null || suite.access[a.app]);

  return (
    <div className="appswitch" ref={root}>
      <button ref={button} type="button" className="iconbtn" aria-label="Switch app" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((o) => !o)}>
        <Icon name="grid" />
      </button>
      {open && (
        <nav id={id} className="appswitch-menu" aria-label="TT Suite apps">
          <ul>
            {apps.map((a) => (
              <li key={a.href}>
                <a href={a.href} className="navlink" aria-current={a.app === CURRENT ? "page" : undefined}>
                  <Icon name={a.icon} /><span className="label">{a.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
