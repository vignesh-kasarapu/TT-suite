// App shell from the wireframes: top bar (logo, search, bell, person) and a left sidebar
// with "New claim" and role-based text links. On narrow screens the sidebar opens from a menu button.
// The TT Suite app switcher sits in the top bar; signing out ends the suite session in the portal.
import * as Dialog from "@radix-ui/react-dialog";
import { useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth, useMe } from "../../controllers/useAuth";
import { useBadges } from "../../controllers/useNotifications";
import type { Me } from "../../models/types";
import { AppSwitcher } from "./AppSwitcher";
import { Icon, type IconName } from "./Icon";
import { ConfirmDialog } from "./ui";

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
  const { has, logout } = useAuth();
  const [confirmOut, setConfirmOut] = useState(false);
  const approver = has("APPROVER");
  const finance = has("FINANCE");
  const { unread, levels } = useBadges(true, approver || finance);
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const groups: Group[] = [
    { items: [{ to: "/", label: "Dashboard", icon: "dashboard", end: true }, { to: "/claims", label: "My claims", icon: "receipt", end: true }] },
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

  const search = (e: FormEvent) => {
    e.preventDefault();
    const target = has("ADMIN") && location.pathname.startsWith("/admin") ? "/admin/claims" : "/claims";
    navigate(`${target}?q=${encodeURIComponent(q.trim())}`);
    setMenu(false);
  };
  const initials = me.full_name.split(" ").map((p) => p[0]).slice(0, 2).join("");

  const nav = (
    <>
      <Link className="btn btn--primary new" to="/claims/new" onClick={() => setMenu(false)}><Icon name="plus" /> New claim</Link>
      {groups.map((g, gi) => (
        <nav key={gi} aria-label={g.title ?? "Main"}>
          {g.title && <div className="group">{g.title}</div>}
          {g.items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className="navlink" onClick={() => setMenu(false)}>
              <Icon name={it.icon} /><span className="label">{it.label}</span>{!!it.n && <span className="n">{it.n}</span>}
            </NavLink>
          ))}
        </nav>
      ))}
      {/* Right after the last link (not pinned to the bottom of the page) */}
      <nav aria-label="Account" className="account">
        <NavLink to="/profile" className="navlink" onClick={() => setMenu(false)}><Icon name="users" /><span className="label">Profile</span></NavLink>
        <button className="navlink" onClick={() => { setMenu(false); setConfirmOut(true); }}><Icon name="logout" /><span className="label">Sign out</span></button>
      </nav>
    </>
  );

  return (
    <div className="app">
      <header className="topbar">
        <button className="iconbtn menu-btn" aria-label="Menu" onClick={() => setMenu(true)}><Icon name="list" /></button>
        <div className="brand-slot"><Link to="/" className="brand" aria-label="Tektalis, home"><img src={`${import.meta.env.BASE_URL}brand/tektalis.png`} alt="Tektalis" /></Link></div>
        <form className="search" role="search" onSubmit={search}>
          <label htmlFor="gsearch" className="sr-only">Search</label>
          <input id="gsearch" type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={has("ADMIN") ? "Search claims or users" : approver || finance ? "Search claims or people" : "Search your claims"} />
        </form>
        <div className="end">
          <AppSwitcher />
          <Link to="/notifications" className="iconbtn" aria-label={`Notifications, ${unread} new`}>
            <Icon name="bell" />{unread > 0 && <span className="count">{unread > 99 ? "99+" : unread}</span>}
          </Link>
          <Link to="/profile" className="who">
            <span className="avatar" aria-hidden="true">{initials}</span>
            <span className="name"><b>{me.full_name}</b><span>{roleLabel(me)}</span></span>
          </Link>
        </div>
      </header>
      <div className="body">
        <aside className="side">{nav}</aside>
        <main className="main" key={location.pathname}>
          <div className="main-inner"><Outlet /></div>
        </main>
      </div>
      <ConfirmDialog open={confirmOut} onOpenChange={setConfirmOut} title="Sign out?"
        body="You will be signed out of every TT Suite app and need to sign in again." confirm="Sign out" busyLabel="Signing out" onConfirm={logout} />
      <Dialog.Root open={menu} onOpenChange={setMenu}>
        <Dialog.Portal>
          <Dialog.Overlay className="sheet-overlay" />
          <Dialog.Content className="sheet" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">Menu</Dialog.Title>
            {nav}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
