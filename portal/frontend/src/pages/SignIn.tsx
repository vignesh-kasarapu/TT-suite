import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { Banner } from '../components/ui';
import s from '../styles/portal.module.css';

const ERRORS: Record<string, string> = {
  NOT_ADMITTED: 'Your account has not been invited to the Tektalis Suite yet, or it was deactivated. Ask your administrator for access.',
  OIDC_STATE: 'The sign-in took too long or was interrupted. Please try again.',
  OIDC_EXCHANGE: 'Microsoft could not complete the sign-in. Please try again.',
  OIDC_CLAIMS: 'Your Microsoft account did not provide a usable work email.',
  OIDC_UNAVAILABLE: 'Microsoft sign-in is not available right now. Please try again in a few minutes, or tell your administrator.',
};

type DevUser = { email: string; name: string; isGlobalAdmin: boolean };

const safeReturn = (v: string | null) => (v && v.startsWith('/') && !v.startsWith('//') ? v : '/');

export function SignIn() {
  const [params] = useSearchParams();
  const returnTo = safeReturn(params.get('returnTo'));
  const error = params.get('error');
  const [provider, setProvider] = useState<string | null>(null);
  const [devUsers, setDevUsers] = useState<DevUser[]>([]);

  useEffect(() => {
    api<{ provider: string }>('/api/auth/config').then((c) => {
      setProvider(c.provider);
      if (c.provider === 'dev') void api<DevUser[]>('/api/auth/dev/users').then(setDevUsers);
    });
  }, []);

  async function devSignIn(email: string) {
    await api('/api/auth/dev/sign-in', { method: 'POST', body: JSON.stringify({ email }) });
    window.location.assign(returnTo);
  }

  return (
    <main className={s.signInPage}>
      <div className={s.signInCard}>
        <span className={s.signInBrand}>
          <img className={s.signInLogo} src="/brand/tektalis.svg" alt="Tektalis" width={180} height={32} />
        </span>
        <div className={s.signInHead}>
          <h1 className={s.signInTitle}>Welcome to Tektalis Suite</h1>
          <p className={s.muted}>Sign in with your Microsoft work account to continue.</p>
        </div>
        {error ? (
          <Banner tone="danger">
            {ERRORS[error] ?? 'Sign-in failed. Please try again.'}
            {error === 'NOT_ADMITTED' && params.get('email') ? <div className={s.caption}>Signed in as {params.get('email')}</div> : null}
          </Banner>
        ) : null}
        {provider === 'entra' ? (
          <a className={s.microsoftButton} href={`/api/auth/oidc/start?returnTo=${encodeURIComponent(returnTo)}`} data-testid="sign-in-microsoft">
            <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true">
              <rect x="1" y="1" width="9" height="9" fill="#F25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
              <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
              <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
            </svg>
            Sign in with Microsoft
          </a>
        ) : null}
        {provider === 'dev' ? (
          <div className={s.devList}>
            <p className={s.caption}>Development sign-in: pick an invited person.</p>
            {devUsers.map((u) => (
              <button key={u.email} type="button" className={`${s.button} ${s.secondary}`} onClick={() => void devSignIn(u.email)}>
                {u.name} {u.isGlobalAdmin ? '(global admin)' : ''}
              </button>
            ))}
            {devUsers.length === 0 ? <p className={s.caption}>Nobody is invited yet. Set SEED_GLOBAL_ADMIN_EMAIL.</p> : null}
          </div>
        ) : null}
        <p className={`${s.caption} ${s.signInFoot}`}>Only people invited by an administrator can sign in.</p>
      </div>
    </main>
  );
}
