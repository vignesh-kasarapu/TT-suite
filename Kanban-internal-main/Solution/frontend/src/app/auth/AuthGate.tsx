// Protected area. TT Suite (SUITE-CONTRACT §3.4): sign-in is the portal's - no session (401)
// goes to the portal's /login with this page as returnTo; signed in without Kanban access
// (403 NO_APP_ACCESS) goes to the portal dashboard. Otherwise the Shell with the server's
// context, in the theme the person chose in the suite.
import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Skeleton } from '../../components';
import { t } from '../../i18n/t';
import { UNAUTHENTICATED_EVENT } from '../../api/client';
import { ApiStatusError, useMe } from './useMe';
import { clearSignedIn, markSignedIn, preserve } from './session';
import { toDenied, toLogin, useApplyTheme } from './suite';

export function AuthGate() {
  const me = useMe();
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  useApplyTheme(me.isSuccess);

  // A 401 raised by any in-page call (not only the context refetch) ends the session the same way.
  useEffect(() => {
    const onUnauthenticated = () => {
      preserve({ returnTo: here });
      clearSignedIn();
      toLogin();
    };
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, [here]);

  useEffect(() => {
    if (me.isFetching) return; // decide on settled answers only
    if (me.isError) {
      const err = me.error instanceof ApiStatusError ? me.error : null;
      if (err?.status === 401) {
        preserve({ returnTo: here });
        clearSignedIn();
        toLogin();
      } else if (err?.status === 403 && err.code === 'NO_APP_ACCESS') {
        clearSignedIn();
        toDenied();
      }
      return;
    }
    if (me.isSuccess) markSignedIn();
  }, [me.isFetching, me.isError, me.isSuccess, me.error, here]);

  if (me.isPending && !me.data) return <Skeleton lines={4} label={t('auth.checking')} />;
  if (me.isError) {
    const status = me.error instanceof ApiStatusError ? me.error.status : 0;
    if (status === 401 || status === 403) return null;
    return <Skeleton lines={4} label={t('auth.checking')} />;
  }
  if (!me.data) return null;
  return <Outlet context={me.data} />;
}
