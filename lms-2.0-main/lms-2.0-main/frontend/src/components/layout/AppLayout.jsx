import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { AppTopBar, PageTitleContext } from './Topbar';

/** The TT Suite app shell (same layout as Kanban's): the 64px top bar across the full window
 * width, the side nav below it on the left (256px desktop / 72px icon rail on tablets) and
 * <main> to the right, scrolling on its own. Phones: top bar / main / bottom bar. */
export default function AppLayout({ title }) {
  const mainRef = useRef(null);
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [pageTitle, setPageTitle] = useState(null);

  // Scrolling is scoped to <main> (not the window), so React Router's default
  // scroll-restoration never kicks in here — reset it manually on every
  // navigation, including switching between Administration's sections
  // (a ?section= query-string change on the same route). Also close the
  // mobile nav drawer so a route change doesn't leave it open over the page.
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
    setMobileNavOpen(false);
  }, [location.pathname, location.search]);

  return (
    <PageTitleContext.Provider value={setPageTitle}>
      <div className="app-shell">
        <AppTopBar title={pageTitle} />
        <Sidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
        <main ref={mainRef} className="main">
          <Outlet context={{ title }} />
        </main>
        <BottomNav onOpenMenu={() => setMobileNavOpen(true)} />
      </div>
    </PageTitleContext.Provider>
  );
}
