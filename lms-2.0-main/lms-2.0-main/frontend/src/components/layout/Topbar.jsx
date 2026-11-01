import { createContext, useContext, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { asset } from '../../api/paths';
import NotificationBell from '../common/NotificationBell';
import SuiteBarControls from './SuiteBarControls';
import AppSwitcher from './AppSwitcher';

/** Setter for the page title shown in the shell's top bar (provided by AppLayout). */
export const PageTitleContext = createContext(null);

// Used when a page does not name itself (e.g. Administration has its own in-page heading).
const FALLBACK_TITLES = {
  '/': 'Dashboard',
  '/apply': 'Apply for Leave',
  '/my-requests': 'My Requests',
  '/team-calendar': 'Team Calendar',
  '/holidays': 'Holiday Calendar',
  '/approvals': 'Approvals',
  '/my-team': 'My Team',
  '/delegation': 'Delegation Management',
  '/reports': 'Reports',
  '/comp-off': 'Compensatory Off',
  '/administration': 'Administration',
};

/**
 * Pages render `<Topbar title="..." />` to name themselves. The bar itself is drawn once by
 * the shell (AppTopBar, full window width above the side nav, as in every TT Suite app), so
 * this only hands the title up and renders nothing in place.
 */
export default function Topbar({ title }) {
  const setTitle = useContext(PageTitleContext);
  useEffect(() => {
    if (!setTitle) return undefined;
    setTitle(title ?? null);
    return () => setTitle(null);
  }, [title, setTitle]);
  return null;
}

/** The TT Suite top bar: exactly 64px. Left: the Tektalis logo (the suite dashboard, a full page
 * load) | "Leave Management" (the LMS home) | the page title. Right, in the same order, glyphs
 * and sizes as every suite app (Kanban's is the reference): the suite app switcher, LMS's
 * notifications (envelope), then the suite's standard controls - light/dark | avatar + name
 * (portal profile), sign out (see SuiteBarControls). */
export function AppTopBar({ title }) {
  const { pathname } = useLocation();
  const shown = title || FALLBACK_TITLES[pathname] || (pathname.startsWith('/my-requests/') ? 'Request detail' : '');

  return (
    <header className="topbar">
      <div className="topbar-start">
        <a href="/" className="brand" aria-label="Tektalis dashboard" title="Tektalis dashboard" data-testid="brand-home">
          <img src={asset('brand/tektalis.svg')} alt="Tektalis" className="logo" width={146} height={26} />
        </a>
        <span className="topbar-divider topbar-app-divider" aria-hidden="true" />
        <Link to="/" className="topbar-app-name" data-testid="app-name">Leave Management</Link>
        {shown && (
          <>
            <span className="topbar-divider topbar-title-divider" aria-hidden="true" />
            <h1 className="topbar-title">{shown}</h1>
          </>
        )}
      </div>
      <div className="who" data-testid="who">
        <AppSwitcher />
        <NotificationBell />
        <SuiteBarControls />
      </div>
    </header>
  );
}
