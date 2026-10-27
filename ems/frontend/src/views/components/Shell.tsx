// App shell from the wireframes: top bar (logo + app name, then the suite controls) and a left sidebar
// with "New claim" and role-based text links. On narrow screens the sidebar opens from a menu button.
// The suite app switcher sits just before the inbox, as in every suite app; the logo goes back to the suite dashboard. The person's profile (name, theme) is the portal's (/profile).
// Sign out opens a card in place (SignOutDialog); /signout stays as the link's fallback without JavaScript.
import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState, type MouseEvent } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { effectiveMode, useAuth, useMe } from "../../controllers/useAuth";
import { useBadges } from "../../controllers/useNotifications";
import type { Me } from "../../models/types";
import { AppSwitcher } from "./AppSwitcher";
import { Icon, type IconName } from "./Icon";
import { SignOutDialog } from "./SignOutDialog";

interface Item { to: string; label: string; icon: IconName; n?: number; end?: boolean }
interface Group { title?: string; items: Item[] }

/** The role shown under the person's name (wireframe: Employee / Manager / Second approver / Finance reviewer / Admin). */
export function roleLabel(me: Me): string {
  if (me.roles.includes("ADMIN")) return "Admin";
  if (me.roles.includes("FINANCE")) return "Finance reviewer";
  if (me.roles.includes("APPROVER")) return me.is_level2_approver ? "Second approver" : "Manager";
  return "Employee";
}

export function Shell() {
  const me = useMe();
  const { has, toggleMode, suite } = useAuth();
  const dark = effectiveMode() === "dark";
  const approver = has("APPROVER");
  const finance = has("FINANCE");
  const { unread, levels } = useBadges(true, approver || finance);
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  // Sign-out card: remembers what opened it so focus can go back there (the phone menu closes first,
  // so its "Sign out" falls back to the menu button)
  const [signingOut, setSigningOut] = useState(false);
  const signOutFrom = useRef<HTMLElement | null>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const openSignOut = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    signOutFrom.current = e.currentTarget;
    setMenu(false);
    setSigningOut(true);
  };

  const groups: Group[] = [
    { items: [{ to: "/", label: "Dashboard", icon: "home", end: true }, { to: "/claims", label: "My claims", icon: "receipt", end: true }] },
  ];
  const work: Item[] = [];
  if (approver) work.push({ to: "/approvals", label: "Approvals", icon: "inbox", n: levels.L1 });
  if (approver && (me.is_level2_approver || levels.L2 > 0)) work.push({ to: "/second-approval", label: "Second approval", icon: "doublecheck", n: levels.L2 });
  if (finance) {
    work.push({ to: "/finance/review", label: "Finance review", icon: "search", n: levels.FINANCE });
    work.push({ to: "/policy", label: "Categories & policy", icon: "book" });
    work.push({ to: "/finance/payroll", label: "Payroll", icon: "wallet" }, { to: "/finance/advances", label: "Advances", icon: "clock" },
      { to: "/finance/bank-changes", label: "Bank changes", icon: "bank" });
  }
  if (approver || finance) work.push({ to: "/delegation", label: "Delegation", icon: "swap" });
  groups[0].items.push(...work);
  if (has("ADMIN")) {
    groups.push({ title: "Admin", items: [
      { to: "/admin/claims", label: "All claims", icon: "grid" }, { to: "/admin", label: "Reports", icon: "chart", end: true },
      { to: "/admin/audit", label: "Audit log", icon: "paper" }, { to: "/admin/settings", label: "Settings", icon: "cog" },
    ] });
  }

  const initials = me.full_name.split(" ").map((p) => p[0]).slice(0, 2).join("");

  const nav = (
    <>
      <Link className="btn btn--primary btn--new-claim new" to="/claims/new" title="New claim" onClick={() => setMenu(false)}><Icon name="plus" /><span className="label">New claim</span></Link>
      {groups.map((g, gi) => (
        <nav key={gi} aria-label={g.title ?? "Main"}>
          {g.title && <div className="group">{g.title}</div>}
          {g.items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className="navlink" title={it.label} onClick={() => setMenu(false)}>
              <Icon name={it.icon} /><span className="label">{it.label}</span>{!!it.n && <span className="n">{it.n}</span>}
            </NavLink>
          ))}
        </nav>
      ))}
      {/* Right after the last link (not pinned to the bottom of the page) */}
      <nav aria-label="Account" className="account">
        <NavLink to="/profile" className="navlink" title="Bank & notifications" onClick={() => setMenu(false)}><Icon name="bank" /><span className="label">Bank &amp; notifications</span></NavLink>
        <a href="/profile" className="navlink" title="Profile"><Icon name="users" /><span className="label">Profile</span></a>
      </nav>
    </>
  );

  return (
    <div className="app">
      <header className="topbar">
        <button ref={menuBtn} className="iconbtn menu-btn" aria-label="Menu" onClick={() => setMenu(true)}><Icon name="list" /></button>
        <div className="brand-slot">
          <a href="/" className="brand" aria-label="Tektalis dashboard" title="Tektalis dashboard" data-testid="brand-home"><img src={`${import.meta.env.BASE_URL}brand/tektalis.svg`} alt="Tektalis" /></a>
          <span className="app-divider" aria-hidden="true" />
          <Link to="/" className="app-name" data-testid="app-name">Expense Management</Link>
        </div>
        <div className="end">
          {/* The same controls, in this order, in every TT Suite app (Kanban's top bar):
              app switcher, inbox, light/dark | the person (portal profile), sign out */}
          <AppSwitcher />
          <Link to="/notifications" className="iconbtn" aria-label={`Notifications, ${unread} new`} title="Notifications">
            <Icon name="mail" />{unread > 0 && <span className="count">{unread > 99 ? "99+" : unread}</span>}
          </Link>
          <button type="button" className="iconbtn suite-ctl" data-testid="theme-toggle" onClick={toggleMode}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Switch to light mode" : "Switch to dark mode"}>
            <Icon name={dark ? "sun" : "moon"} />
          </button>
          <span className="divider" aria-hidden="true" />
          <a href="/profile" className="who" title={`${me.full_name} · ${roleLabel(me)}`}>
            {suite?.photoUrl
              ? <img className="avatar avatar--photo" src={suite.photoUrl} alt="" />
              : <span className="avatar" aria-hidden="true">{initials}</span>}
            <span className="who-text">
              <span className="name">{me.full_name}</span>
              {suite?.employeeCode && <span className="code" data-testid="header-employee-code">{suite.employeeCode}</span>}
            </span>
          </a>
          <a href="/signout" className="iconbtn signout" data-testid="sign-out" aria-label="Sign out" title="Sign out" aria-haspopup="dialog" onClick={openSignOut}><Icon name="logout" /></a>
        </div>
      </header>
      <aside className="side">{nav}</aside>
      {/* main is the scroll container (the top bar and side nav stay put), so it is keyboard-reachable */}
      <main className="main" id="main" tabIndex={0} key={location.pathname}>
        <div className="main-inner"><Outlet /></div>
      </main>
      <Dialog.Root open={menu} onOpenChange={setMenu}>
        <Dialog.Portal>
          <Dialog.Overlay className="sheet-overlay" />
          <Dialog.Content className="sheet" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">Menu</Dialog.Title>
            {nav}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <SignOutDialog open={signingOut} onOpenChange={setSigningOut}
        returnFocus={() => (signOutFrom.current?.isConnected && signOutFrom.current.offsetParent !== null ? signOutFrom.current : menuBtn.current)} />
    </div>
  );
}
