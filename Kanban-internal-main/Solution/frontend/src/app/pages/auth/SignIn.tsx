// Sign-in. TT Suite (SUITE-CONTRACT §3.4): sign-in is the portal's, so this page only hands
// over to the portal's /login, with the page the person asked for (under /kanban/) as returnTo.
// The dev picker and "Sign in with Microsoft" are gone; tests sign in with the dev/test-only
// POST /api/v1/auth/dev/sign-in, which sets the suite session cookie.
import { useEffect } from 'react';
import { AuthLayout } from './AuthLayout';
import { Skeleton } from '../../../components';
import { t } from '../../../i18n/t';
import { safeReturnTo, take } from '../../auth/session';

/** The router-relative return path, as a site path under Kanban's prefix. */
function returnPath(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return base + safeReturnTo(take()?.returnTo);
}

export function SignIn() {
  useEffect(() => {
    window.location.assign('/login?returnTo=' + encodeURIComponent(returnPath()));
  }, []);
  return (
    <AuthLayout title={t('signIn.title')} testId="sign-in">
      <Skeleton lines={2} label={t('signIn.redirecting')} />
    </AuthLayout>
  );
}
