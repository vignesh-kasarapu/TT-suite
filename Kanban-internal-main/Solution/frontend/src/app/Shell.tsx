// App shell: top bar + nav (side nav / icon rail / bottom bar + "More" sheet) + main.
// The nav set comes from the role getMe returned (decided on the server).
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import s from './Shell.module.css';
import { barOrder, moreOrder, navFor, type NavItem } from './nav-items';
import { Icon } from '../components/Icon';
import { Avatar } from '../components/Avatar';
import { ConfirmDialog } from '../components';
import { MQ, useMediaQuery } from '../components/useMediaQuery';
import { t } from '../i18n/t';
import { cx } from '../styles/cx';
import { useContextData } from './auth/useMe';
import { clearSignedIn } from './auth/session';
import {
  SUITE_APP,
  SUITE_APPS,
  portalSignOut,
  usePortalMe,
  useThemePreferences,
} from './auth/suite';
import { NewCardDialog } from './cards/NewCardDialog';
import { useProgressReport } from './cards/api';

/** Light / dark in one press (D-119); "system" resolves to what the device shows now. The
 *  theme is the suite's (SUITE-CONTRACT §3.4): saved to the portal for every app. */
function ThemeToggle() {
  const theme = useThemePreferences();
  const deviceDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode = theme.current?.mode ?? 'system';
  const dark = mode === 'dark' || (mode === 'system' && deviceDark);
  const next = dark ? 'light' : 'dark';
  const label = t(dark ? 'nav.lightMode' : 'nav.darkMode');
  return (
    <button
      type="button"
      className={s.whoAction}
      onClick={() => theme.set({ mode: next })}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
    >
      <Icon name={dark ? 'sun' : 'moon'} size={20} />
    </button>
  );
}

/**
 * TT Suite (SUITE-CONTRACT §3.4): the portal Dashboard and every app the person has access to
 * (`access[app]` from the portal's GET /api/me). These are whole-page links out of Kanban's
 * router. Without a portal (Kanban run on its own) there is nothing to switch to.
 */
function AppSwitcher() {
  const portal = usePortalMe();
  if (!portal.data) return null;
  const access = portal.data.access;
  const apps = SUITE_APPS.filter((a) => access[a.app] != null);
  return (
    <details className={s.appMenu} data-popover data-testid="app-switcher">
      <summary
        className={s.whoAction}
        aria-label={t('suite.switcher')}
        title={t('suite.switcherTip')}
        data-testid="app-switcher-open"
      >
        <Icon name="apps" size={20} />
      </summary>
      <nav className={s.appPanel} aria-label={t('suite.switcherTip')}>
        <ul className={s.appList}>
          <li>
            <a href="/" data-testid="app-dashboard">
              <Icon name="home" size={18} />
              {t('suite.dashboard')}
            </a>
          </li>
          {apps.map((a) => (
            <li key={a.app}>
              <a
                href={a.href}
                aria-current={a.app === SUITE_APP ? 'page' : undefined}
                data-testid={`app-${a.app}`}
              >
                <Icon
                  name={a.app === 'kanban' ? 'board' : a.app === 'lms' ? 'cal' : 'chart'}
                  size={18}
                />
                {t(a.label)}
                {a.app === SUITE_APP ? (
                  <span className={s.appCurrent}>
                    <Icon name="check" size={16} />
                  </span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}

/** Notifications: the inbox, with its unread count (D-066, D-119); an envelope since D-158. */
function Bell({ unread }: { unread: number }) {
  const label = unread > 0 ? t('nav.unreadTip', { n: String(unread) }) : t('nav.notifications');
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
 * D-150: search from any page - Enter opens the Search page with the text (it reads `q`);
 * Ctrl+K (Cmd+K) puts the cursor here. Phones reach Search from the More sheet instead.
 */
function TopSearch() {
  const navigate = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <form
      role="search"
      className={s.topSearch}
      onSubmit={(e) => {
        e.preventDefault();
        void navigate(`/search?q=${encodeURIComponent(text.trim())}`);
      }}
    >
      <Icon name="search" size={18} />
      <input
        ref={ref}
        type="search"
        className={s.topSearchInput}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('top.searchPlaceholder')}
        aria-label={t('top.search')}
        data-testid="top-search"
      />
      <kbd className={s.kbd} aria-hidden="true">
        {t('top.searchKey')}
      </kbd>
    </form>
  );
}

/** D-150: one Create button for every page, with the plane to create on in its menu. */
function CreateMenu() {
  const navigate = useNavigate();
  const [plane, setPlane] = useState<'org' | 'private' | null>(null);
  const ref = useRef<HTMLDetailsElement>(null);
  const pick = (p: 'org' | 'private') => {
    ref.current?.removeAttribute('open');
    setPlane(p);
  };
  return (
    <>
      <details ref={ref} className={s.createMenu} data-popover data-testid="create-menu">
        <summary className={s.createButton} data-testid="create-open">
          <Icon name="plus" size={20} />
          <span className={s.createText}>{t('top.create')}</span>
          <Icon name="down" size={16} />
        </summary>
        <div className={s.createPanel}>
          <button type="button" onClick={() => pick('org')} data-testid="create-org">
            <Icon name="users" size={18} />
            {t('top.createOrg')}
          </button>
          <button type="button" onClick={() => pick('private')} data-testid="create-private">
            <Icon name="lock" size={18} />
            {t('top.createPrivate')}
          </button>
        </div>
      </details>
      {plane ? (
        <NewCardDialog
          ctx={{ plane, extra: {} }}
          onClose={() => setPlane(null)}
          onCreated={(key) =>
            void navigate(plane === 'org' ? `/org/cards/${key}` : `/cards/${key}`)
          }
        />
      ) : null}
    </>
  );
}

function TopBar({
  user,
  unread,
}: {
  user: { id: string; name: string; photoUpdatedAt?: string | null };
  unread: number;
}) {
  return (
    <header className={s.topbar}>
      <NavLink
        to="/"
        className={cx(s.brand)}
        aria-label={t('nav.dashboard')}
        title={t('nav.homeTip')}
      >
        <img
          className={s.logo}
          src={`${import.meta.env.BASE_URL}brand/tektalis.png`}
          alt={t('brand.alt')}
          width={262}
          height={57}
        />
      </NavLink>
      <TopSearch />
      <div className={s.who} data-testid="who">
        <AppSwitcher />
        <CreateMenu />
        <Bell unread={unread} />
        <ThemeToggle />
        <span className={s.divider} aria-hidden="true" />
        <Avatar user={user} />
        <span className={s.whoName}>{user.name}</span>
        <SignOutButton compact />
      </div>
    </header>
  );
}

/** D-159: signing out asks first - a stray press on the top-bar icon would end the session.
 *  TT Suite (SUITE-CONTRACT §3.4): sign-out is the portal's and ends every app's session. */
function SignOutButton({ compact }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    clearSignedIn();
    queryClient.clear();
    await portalSignOut();
  }
  return (
    <>
      <button
        type="button"
        className={cx(compact ? s.whoAction : s.sheetItem, compact && s.whoSignOut)}
        onClick={() => setAsking(true)}
        title={compact ? t('nav.signOut') : undefined}
        data-testid="sign-out"
      >
        <Icon name="logout" size={compact ? 18 : 22} />
        <span className={compact ? 'visually-hidden' : undefined}>{t('nav.signOut')}</span>
      </button>
      {/* Only while asking: the top bar and the phone's More sheet each have a Sign out. */}
      {asking ? (
        <ConfirmDialog
          open
          title={t('nav.signOutTitle')}
          confirmLabel={t('nav.signOut')}
          cancelLabel={t('card.cancel')}
          busy={busy}
          onCancel={() => setAsking(false)}
          onConfirm={() => void signOut()}
          testId="sign-out-confirm"
        >
          {t('nav.signOutBody')}
        </ConfirmDialog>
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
      <TopBar user={me.user} unread={me.inboxUnread} />
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
