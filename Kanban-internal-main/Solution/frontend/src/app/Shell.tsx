// App shell: top bar + nav (side nav / icon rail / bottom bar + "More" sheet) + main.
// The nav set comes from the role getMe returned (decided on the server).
import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import s from './Shell.module.css';
import { barOrder, moreOrder, navFor, type NavItem } from './nav-items';
import { Alert, Button } from '../components';
import { Icon } from '../components/Icon';
import { Avatar } from '../components/Avatar';
import { MQ, useMediaQuery } from '../components/useMediaQuery';
import { t } from '../i18n/t';
import { cx } from '../styles/cx';
import { useContextData } from './auth/useMe';
import { clearSignedIn } from './auth/session';
import {
  PORTAL_ME_KEY,
  PORTAL_PROFILE,
  SUITE_APP,
  SUITE_APPS,
  fetchPortalSessions,
  portalLogout,
  savePortalTheme,
  usePortalMe,
  useThemePreferences,
  type SuiteApp,
} from './auth/suite';
import { applyMode } from '../theme/theme-switch';
import { useProgressReport } from './cards/api';

/**
 * TT Suite: the same four controls end every suite app's top bar - light/dark, the suite Inbox,
 * the person (their portal profile) and sign out.
 *
 * Light/dark: the effective mode is what <html data-theme> shows now (the device's when the saved
 * mode is "system"). A press applies the other mode at once, then saves it as the SUITE theme
 * (the portal's PUT /api/me/preferences) and refreshes the cached portal person.
 */
function ThemeToggle() {
  const queryClient = useQueryClient();
  const theme = useThemePreferences();
  const deviceDark = useMediaQuery('(prefers-color-scheme: dark)');
  const [, rerender] = useState(0);
  const attr = typeof document !== 'undefined' ? document.documentElement.dataset['theme'] : '';
  const saved = theme.current?.mode ?? 'system';
  const dark =
    attr === 'dark' || attr === 'light'
      ? attr === 'dark'
      : saved === 'dark' || (saved === 'system' && deviceDark);
  const next = dark ? 'light' : 'dark';
  const label = t(dark ? 'nav.lightMode' : 'nav.darkMode');
  async function toggle() {
    applyMode(next);
    rerender((n) => n + 1);
    const preset = theme.current?.preset ?? 'linen';
    try {
      await savePortalTheme({ preset, mode: next });
    } catch {
      return; // no portal (Kanban run on its own): the change stays on this page
    }
    await queryClient.invalidateQueries({ queryKey: PORTAL_ME_KEY });
  }
  return (
    <button
      type="button"
      className={s.suiteAction}
      onClick={() => void toggle()}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
    >
      <Icon name={dark ? 'sun' : 'moon'} size={20} />
    </button>
  );
}

/** Kanban's own card notifications (D-066, D-119): its in-app /inbox page, an envelope with the
 *  unread count. The only inbox button in the top bar. */
function Bell({ unread }: { unread: number }) {
  const label = unread > 0 ? t('nav.unread', { n: String(unread) }) : t('nav.inbox');
  return (
    <Link to="/inbox" className={s.whoAction} aria-label={label} title={label} data-testid="bell">
      <Icon name="mail" size={20} />
      {unread > 0 ? (
        <span className={s.bellCount} aria-hidden="true" data-testid="bell-count">
          {unread > 99 ? '99+' : String(unread)}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * TT Suite app switcher (SUITE-CONTRACT §3.4) - the same button, panel and glyphs in every suite
 * app: the portal Dashboard, then each app the person can open (portal GET /api/me ->
 * access[app] != null). Whole-page links out of Kanban's router. Nothing renders until the
 * portal has answered (and nothing at all when Kanban runs without a portal).
 */
const SWITCHER_GLYPHS = {
  apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  dashboard: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
  kanban: 'M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v13h-4z',
  lms: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  expense: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zm3 5h6M9 12h6M9 16h3',
  ams: 'M21 8 12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
  resume: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 15l2 2 4-4',
  check: 'M5 12l5 5L20 7',
} as const;

function SwitcherGlyph({ name, size }: { name: keyof typeof SWITCHER_GLYPHS; size: number }) {
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
      <path d={SWITCHER_GLYPHS[name]} />
    </svg>
  );
}

const SWITCHER_ORDER: readonly SuiteApp[] = ['kanban', 'lms', 'expense', 'ams', 'resume'];

function AppSwitcher() {
  const portal = usePortalMe();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const items = () => [
      ...(root?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ?? []),
    ];
    const onDown = (e: PointerEvent) => {
      if (!root?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      const list = items();
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

  if (!portal.data) return null;
  const access = portal.data.access;
  const apps = SWITCHER_ORDER.filter((app) => access[app] != null).flatMap((app) =>
    SUITE_APPS.filter((a) => a.app === app),
  );

  return (
    <div ref={rootRef} className={s.appSwitcher} data-testid="app-switcher">
      <button
        ref={buttonRef}
        type="button"
        className={s.appSwitcherButton}
        aria-label={t('suite.switcher')}
        title={t('suite.switcher')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        data-testid="app-switcher-open"
      >
        <SwitcherGlyph name="apps" size={20} />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t('suite.switcherTip')}
          className={s.appSwitcherPanel}
          data-testid="app-switcher-menu"
        >
          <a
            href="/"
            role="menuitem"
            className={s.appSwitcherItem}
            onClick={() => setOpen(false)}
            data-testid="app-dashboard"
          >
            <SwitcherGlyph name="dashboard" size={18} />
            <span className={s.appSwitcherLabel}>{t('suite.dashboard')}</span>
          </a>
          {apps.map((a) => {
            const current = a.app === SUITE_APP;
            return (
              <a
                key={a.app}
                href={a.href}
                role="menuitem"
                className={s.appSwitcherItem}
                aria-current={current ? 'page' : undefined}
                onClick={() => setOpen(false)}
                data-testid={`app-${a.app}`}
              >
                <SwitcherGlyph name={a.app} size={18} />
                <span className={s.appSwitcherLabel}>{t(a.label)}</span>
                {current ? <SwitcherGlyph name="check" size={16} /> : null}
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** The top-bar avatar: the person's suite profile photo (portal GET /api/me photoUrl, uploaded on
 *  the dashboard Profile page) when they have one, else their initials. */
function TopAvatar({ name }: { name: string }) {
  const portal = usePortalMe();
  const photoUrl = portal.data?.photoUrl ?? null;
  // The URL is fixed (/api/me/photo); the fetch time busts the cache after a new upload.
  const src = photoUrl
    ? `${photoUrl}${photoUrl.includes('?') ? '&' : '?'}v=${String(portal.dataUpdatedAt)}`
    : null;
  return <TopAvatarImage key={src ?? ''} src={src} name={name} />;
}

function TopAvatarImage({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken)
    return (
      <img
        className={s.avatarImg}
        src={src}
        alt=""
        width={28}
        height={28}
        onError={() => setBroken(true)}
        data-testid="avatar-img"
      />
    );
  return <Avatar user={{ id: '', name }} />;
}

/** The person's name in the top bar, with their employee code (portal GET /api/me) under it
 *  when they have one. */
function TopWho({ name }: { name: string }) {
  const code = usePortalMe().data?.employeeCode?.trim() || null;
  return (
    <span className={s.whoText}>
      <span className={s.whoName}>{name}</span>
      {code ? (
        <span className={s.whoCode} data-testid="header-employee-code">
          {code}
        </span>
      ) : null}
    </span>
  );
}

function TopBar({ name, unread }: { name: string; unread: number }) {
  return (
    <header className={s.topbar}>
      <div className={s.brandGroup}>
        {/* The suite dashboard, not Kanban's home: a full page load out of the Kanban app. */}
        <a
          href="/"
          className={cx(s.brand)}
          aria-label={t('nav.suiteHome')}
          title={t('nav.suiteHome')}
          data-testid="brand-home"
        >
          <img
            className={s.logo}
            src={`${import.meta.env.BASE_URL}brand/tektalis.svg`}
            alt={t('brand.alt')}
            width={146}
            height={26}
          />
        </a>
        <span className={s.appDivider} aria-hidden="true" />
        {/* Kanban's home (My board), inside the app router. */}
        <Link to="/" className={s.appName} data-testid="app-name">
          {t('suite.app.kanban')}
        </Link>
      </div>
      <div className={s.who} data-testid="who">
        {/* The suite app switcher, Kanban's inbox, light/dark | the person (portal profile),
            sign out - the same order in every suite app. */}
        <AppSwitcher />
        <Bell unread={unread} />
        <ThemeToggle />
        <span className={s.divider} aria-hidden="true" />
        {/* The profile (name, picture, theme) is the portal's - a whole-page link. */}
        <a
          href={PORTAL_PROFILE}
          className={s.whoProfile}
          title={t('nav.profile')}
          data-testid="profile-link"
        >
          <TopAvatar name={name} />
          <TopWho name={name} />
        </a>
        <SignOutButton compact />
      </div>
    </header>
  );
}

/**
 * TT Suite: sign out opens a card in place (a modal <dialog>, no page load). It says how many
 * devices the person is signed in on (portal GET /api/me/sessions) and signs out of this device
 * or all of them (portal POST /api/auth/logout), then goes to the portal's sign-in page.
 */
function SignOutDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const ref = useRef<HTMLDialogElement>(null);
  const [devices, setDevices] = useState<number | null | 'error'>(null);
  const [busy, setBusy] = useState<'this' | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    // Focus goes into the card, on its first action.
    el?.querySelector<HTMLButtonElement>('[data-testid="signout-this"]')?.focus();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchPortalSessions(ctrl.signal).then(
      (items) => setDevices(items.length),
      () => {
        if (!ctrl.signal.aborted) setDevices('error');
      },
    );
    return () => ctrl.abort();
  }, []);

  async function signOut(everywhere: boolean) {
    setBusy(everywhere ? 'all' : 'this');
    setError(null);
    try {
      await portalLogout(everywhere);
    } catch (e) {
      setError((e instanceof Error && e.message) || t('signout.failed'));
      setBusy(null);
      return;
    }
    clearSignedIn();
    queryClient.clear();
    window.location.assign('/login');
  }

  const n = typeof devices === 'number' ? devices : 0;
  const text =
    devices === null
      ? t('signout.checking')
      : devices === 'error'
        ? null
        : n > 1
          ? t('signout.devices', { n })
          : t('signout.thisOnly');

  return (
    // The backdrop click is a mouse shortcut; its keyboard equivalent is Escape (the native cancel).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      className={s.signOut}
      aria-labelledby="signout-title"
      onClose={onClose}
      onClick={(e) => {
        // A press on the dialog element itself (not the card inside it) is the backdrop.
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      data-testid="signout-dialog"
    >
      <div className={s.signOutCard}>
        <h2 id="signout-title" className={s.signOutTitle}>
          {t('signout.title')}
        </h2>
        {text ? (
          <p className={s.signOutText} aria-live="polite" data-testid="signout-devices">
            {text}
          </p>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className={s.signOutActions}>
          <Button
            variant="primary"
            onClick={() => void signOut(false)}
            busy={busy === 'this'}
            busyLabel={t('signout.busy')}
            disabled={busy !== null}
            data-testid="signout-this"
          >
            {t('signout.this')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void signOut(true)}
            busy={busy === 'all'}
            busyLabel={t('signout.busy')}
            disabled={busy !== null}
            data-testid="signout-all"
          >
            {n > 1 ? t('signout.allCount', { n }) : t('signout.all')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => ref.current?.close()}
            data-testid="signout-cancel"
          >
            {t('signout.cancel')}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** The sign-out trigger: an icon in the top bar (compact) or a row in the phone More sheet. */
function SignOutButton({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cx(compact ? s.whoAction : s.sheetItem, compact && s.whoSignOut)}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title={compact ? t('nav.signOut') : undefined}
        data-testid="sign-out"
      >
        <Icon name="logout" size={compact ? 18 : 22} />
        <span className={compact ? 'visually-hidden' : undefined}>{t('nav.signOut')}</span>
      </button>
      {open ? (
        <SignOutDialog
          onClose={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

function NavItemLink({ item, title }: { item: NavItem; title?: boolean }) {
  // Active state computed here: "My board" owns / and its plane tab /org (D-059), and the
  // card routes nested under it.
  const { pathname } = useLocation();
  const active =
    item.to === '/'
      ? pathname === '/' || pathname.startsWith('/org') || pathname.startsWith('/cards')
      : pathname === item.to || pathname.startsWith(`${item.to}/`);
  return (
    <Link
      to={item.to}
      className={cx(s.item)}
      aria-current={active ? 'page' : undefined}
      title={title ? t(item.label) : undefined}
    >
      <Icon name={item.icon} />
      <span>{t(item.label)}</span>
    </Link>
  );
}

function MoreSheet({
  items,
  open,
  onClose,
}: {
  items: readonly NavItem[];
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={s.sheet}
      aria-labelledby="more-sheet-title"
      onClose={onClose}
      data-testid="more-sheet"
    >
      <div className={s.sheetHead}>
        <h2 id="more-sheet-title">{t('sheet.title')}</h2>
        <button
          type="button"
          className={s.sheetClose}
          aria-label={t('sheet.close')}
          title={t('sheet.close')}
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
      </div>
      <ul className={s.sheetList}>
        {items.map((item) => (
          <li key={item.key}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={cx(s.sheetItem)}
              onClick={onClose}
            >
              <Icon name={item.icon} />
              <span>{t(item.label)}</span>
            </NavLink>
          </li>
        ))}
        <li>
          <a href={PORTAL_PROFILE} className={cx(s.sheetItem)} data-testid="sheet-profile">
            <Icon name="users" />
            <span>{t('nav.profile')}</span>
          </a>
        </li>
        <li>
          <SignOutButton />
        </li>
      </ul>
    </dialog>
  );
}

/**
 * D-150: the side nav's foot - my teams' projects and open + delivered cards, with the delivered
 * share as a bar. The numbers are the progress report's (the server scopes it to my teams;
 * admins see all), summed here for display.
 */
function OrgSummary() {
  const report = useProgressReport({ groupBy: 'project' });
  const rows = report.data?.rows ?? [];
  const projects = rows.filter((r) => r.id !== null).length;
  const delivered = rows.reduce((n, r) => n + r.delivered, 0);
  const tasks = rows.reduce((n, r) => n + r.open, 0) + delivered;
  const done = tasks > 0 ? Math.round((delivered / tasks) * 100) : 0;
  if (report.isPending || report.isError) return null;
  return (
    <Link to="/org" className={s.summary} data-testid="org-summary">
      <span className={s.summaryHead}>
        {t('board.tab.org')}
        <Icon name="chev" size={16} />
      </span>
      <span className={s.summaryText}>{t('nav.summary', { projects, tasks })}</span>
      <span
        className={s.summaryBar}
        role="img"
        aria-label={t('nav.summaryDone', { n: done })}
        title={t('nav.summaryDone', { n: done })}
      >
        <span className={s.summaryFill} style={{ width: `${done}%` }} />
      </span>
    </Link>
  );
}

function Nav({ items }: { items: readonly NavItem[] }) {
  const tabletUp = useMediaQuery(MQ.tabletUp);
  const desktopUp = useMediaQuery(MQ.desktopUp);
  const [moreOpen, setMoreOpen] = useState(false);
  if (tabletUp) {
    return (
      <nav className={s.nav} aria-label={t('nav.label')} data-testid="nav">
        {items.map((item) => (
          <NavItemLink key={item.key} item={item} title={!desktopUp} />
        ))}
        {desktopUp ? <OrgSummary /> : null}
      </nav>
    );
  }
  const bar = barOrder([...items]);
  const rest = moreOrder([...items]);
  return (
    <>
      <nav className={s.nav} aria-label={t('nav.label')} data-testid="nav">
        {bar.map((item) => (
          <NavItemLink key={item.key} item={item} />
        ))}
        <button
          type="button"
          className={cx(s.item)}
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
        >
          <Icon name="more" />
          <span>{t('nav.more')}</span>
        </button>
      </nav>
      <MoreSheet items={rest} open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}

/** D-133: a short confirmation at the bottom of the screen after a page closes (e.g. a card
 *  saved and closed), handed over in the route state as `{ flash: text }`; gone after 4 s. */
function Flash() {
  const location = useLocation();
  const navigate = useNavigate();
  const text = (location.state as { flash?: string } | null)?.flash;
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(
      () => void navigate(location.pathname + location.search, { replace: true, state: null }),
      4000,
    );
    return () => clearTimeout(timer);
  }, [text, location.pathname, location.search, navigate]);
  if (!text) return null;
  return (
    <div className={s.flash} role="status" data-testid="flash">
      <Icon name="check" size={18} />
      <span>{text}</span>
    </div>
  );
}

/**
 * D-150: the popover menus (Create, Filters, a card's "...") are <details data-popover>; one
 * listener closes an open one on a press outside it or on Escape, so none is left over the page.
 */
function useClosePopovers() {
  useEffect(() => {
    const open = () => [
      ...document.querySelectorAll<HTMLDetailsElement>('details[data-popover][open]'),
    ];
    const onDown = (e: PointerEvent) => {
      for (const d of open()) if (!d.contains(e.target as Node)) d.removeAttribute('open');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      for (const d of open()) {
        d.removeAttribute('open');
        d.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
}

export function Shell() {
  const me = useContextData();
  useClosePopovers();
  return (
    <div className={s.app}>
      <TopBar name={me.user.name} unread={me.inboxUnread} />
      <Nav items={navFor(me.user.role, me.leadTeamIds.length > 0)} />
      {/* main is the scroll container (bottom bar / rail stay put): keyboard-reachable (axe scrollable-region-focusable). */}
      <main className={s.main} id="main" tabIndex={0}>
        <Outlet context={me} />
      </main>
      <Flash />
    </div>
  );
}

export const pageTitleClass = s.title;
