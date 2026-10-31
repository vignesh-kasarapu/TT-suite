// App shell from the wireframes: top bar (logo + app name, then the suite controls) and a left sidebar
// with "New claim" and role-based text links. On phones (< 640) the sidebar gives way to the suite's bottom bar
// (as in AMS/LMS/Kanban): the first four destinations, then "More", a bottom sheet with every other link.
// The suite app switcher sits just before the inbox, as in every suite app; the logo goes back to the suite dashboard. The person's profile (name, theme) is the portal's (/profile).
// Sign out opens a card in place (SignOutDialog); /signout stays as the link's fallback without JavaScript.
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { useRef, useState, type MouseEvent } from "react";
import { Link, NavLink, useLocation, useOutlet } from "react-router-dom";
import { effectiveMode, useAuth, useMe } from "../../controllers/useAuth";
import { useBadges } from "../../controllers/useNotifications";
import type { Me } from "../../models/types";
import { AppSwitcher } from "./AppSwitcher";
import { Icon, type IconName } from "./Icon";
import { SignOutDialog } from "./SignOutDialog";

interface Item { to: string; label: string; icon: IconName; n?: number; end?: boolean }
interface Group { title?: string; items: Item[] }

/** Phone bottom bar: this many destinations, then "More" (the suite's pattern, as in AMS). */
const PHONE_BAR_SLOTS = 4;

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
  const [more, setMore] = useState(false);
  const location = useLocation();
  // Taken here (not <Outlet />) so the page that is fading out keeps showing itself, not the next page
  const outlet = useOutlet();
  const mainRef = useRef<HTMLElement>(null);
  // Sign-out card: remembers what opened it so focus can go back there (the phone "More" sheet closes first,
  // so its "Sign out" falls back to the More button)
  const [signingOut, setSigningOut] = useState(false);
  const signOutFrom = useRef<HTMLElement | null>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const openSignOut = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    signOutFrom.current = e.currentTarget;
    setMore(false);
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

  // Phone bottom bar: derived from the same list as the sidebar, so roles keep working. New claim sits
  // third (the sidebar's button); the first PHONE_BAR_SLOTS destinations stay in the bar and every other
  // link (the rest of the list, the Admin group, the account links and Sign out) goes to the More sheet,
  // keeping the sidebar's order and its "Admin" heading.
  const newClaim: Item = { to: "/claims/new", label: "New claim", icon: "plus", end: true };
  const [home, mine, ...restMain] = groups[0].items;
  const phoneGroups: Group[] = [{ items: [home, mine, newClaim, ...restMain] }, ...groups.slice(1)];
  const barItems = phoneGroups.flatMap((g) => g.items).slice(0, PHONE_BAR_SLOTS);
  const moreGroups: Group[] = phoneGroups
    .map((g) => ({ ...g, items: g.items.filter((it) => !barItems.includes(it)) }))
    .filter((g) => g.items.length > 0);
  const moreHidden = moreGroups.flatMap((g) => g.items);
  const isOn = (it: Item) => location.pathname === it.to || (!it.end && location.pathname.startsWith(`${it.to}/`));
  const moreActive = moreHidden.some(isOn) || location.pathname === "/profile";
  const morePending = moreHidden.some((it) => !!it.n);

  const initials = me.full_name.split(" ").map((p) => p[0]).slice(0, 2).join("");

  const nav = (
    <>
      <Link className="btn btn--primary btn--new-claim new" to="/claims/new" title="New claim"><Icon name="plus" /><span className="label">New claim</span></Link>
      {groups.map((g, gi) => (
        <nav key={gi} aria-label={g.title ?? "Main"}>
          {g.title && <div className="group">{g.title}</div>}
          {g.items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className="navlink" title={it.label}>
              <Icon name={it.icon} /><span className="label">{it.label}</span>{!!it.n && <span className="n">{it.n}</span>}
            </NavLink>
          ))}
        </nav>
      ))}
      {/* Right after the last link (not pinned to the bottom of the page) */}
      <nav aria-label="Account" className="account">
        <NavLink to="/profile" className="navlink" title="Bank & preferences"><Icon name="bank" /><span className="label">Bank &amp; preferences</span></NavLink>
        <a href="/profile" className="navlink" title="Profile"><Icon name="users" /><span className="label">Profile</span></a>
      </nav>
    </>
  );

  return (
    <div className="app">
      <header className="topbar">
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
      {/* main is the scroll container (the top bar and side nav stay put), so it is keyboard-reachable.
          Page changes match the Resume Evaluator: the old page fades up and out, then the new one fades up in
          (0.15 s each); the scroll goes back to the top in between. */}
      <main className="main" id="main" tabIndex={0} ref={mainRef}>
        <MotionConfig reducedMotion="user">
          <AnimatePresence mode="wait" initial={false} onExitComplete={() => mainRef.current?.scrollTo(0, 0)}>
            <motion.div key={location.pathname} className="main-inner"
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
              {outlet}
            </motion.div>
          </AnimatePresence>
        </MotionConfig>
      </main>
      {/* Phone only (hidden from 640 px up, where the sidebar shows): icon above label, the current page in the accent colour */}
      <nav className="bottombar" aria-label="Main" data-testid="bottom-nav">
        {barItems.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end} className="bar-item" title={it.label}>
            <span className="bar-icon"><Icon name={it.icon} />{!!it.n && <span className="bar-count" aria-label={`${it.n} pending`}>{it.n > 99 ? "99+" : it.n}</span>}</span>
            <span className="bar-label">{it.label}</span>
          </NavLink>
        ))}
        <button ref={moreBtn} type="button" className="bar-item" data-testid="nav-more" title="More" onClick={() => setMore(true)}
          aria-haspopup="dialog" aria-expanded={more} aria-current={moreActive ? "page" : undefined}>
          <span className="bar-icon"><Icon name="more" />{morePending && <span className="bar-dot" aria-hidden="true" />}</span>
          <span className="bar-label">More</span>
        </button>
      </nav>
      <Dialog.Root open={more} onOpenChange={setMore}>
        <Dialog.Portal>
          <Dialog.Overlay className="sheet-overlay" />
          <Dialog.Content className="sheet more-sheet" aria-describedby={undefined} data-testid="more-sheet">
            <div className="sheet-head">
              <Dialog.Title className="sheet-title">More</Dialog.Title>
              <Dialog.Close className="iconbtn sheet-close" aria-label="Close menu" title="Close menu"><Icon name="x" /></Dialog.Close>
            </div>
            {moreGroups.map((g, gi) => (
              <nav key={gi} aria-label={g.title ?? "More"}>
                {g.title && <div className="group">{g.title}</div>}
                {g.items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.end} className="navlink" onClick={() => setMore(false)}>
                    <Icon name={it.icon} /><span className="label">{it.label}</span>{!!it.n && <span className="n">{it.n}</span>}
                  </NavLink>
                ))}
              </nav>
            ))}
            <nav aria-label="Account" className="account">
              <NavLink to="/profile" className="navlink" onClick={() => setMore(false)}><Icon name="bank" /><span className="label">Bank &amp; preferences</span></NavLink>
              <a href="/profile" className="navlink"><Icon name="users" /><span className="label">Profile</span></a>
              <a href="/signout" className="navlink" data-testid="more-sign-out" aria-haspopup="dialog" onClick={openSignOut}><Icon name="logout" /><span className="label">Sign out</span></a>
            </nav>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <SignOutDialog open={signingOut} onOpenChange={setSigningOut}
        returnFocus={() => (signOutFrom.current?.isConnected && signOutFrom.current.offsetParent !== null ? signOutFrom.current : moreBtn.current)} />
    </div>
  );
}
