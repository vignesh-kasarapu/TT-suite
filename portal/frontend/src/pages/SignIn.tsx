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
    <div className={s.signInPage}>
      <div className={`${s.panel} ${s.signInCard}`}>
        <img className={s.signInLogo} src="/brand/tektalis.png" alt="Tektalis" width={262} height={57} />
        <div>
          <h1 className={s.section}>Tektalis Suite</h1>
          <p className={s.muted}>Leave, Expense and Kanban with one sign-in.</p>
        </div>
        {error ? (
          <Banner tone="danger">
            {ERRORS[error] ?? 'Sign-in failed. Please try again.'}
            {error === 'NOT_ADMITTED' && params.get('email') ? <div className={s.caption}>Signed in as {params.get('email')}</div> : null}
          </Banner>
        ) : null}
        {provider === 'entra' ? (
          <a className={s.button} href={`/api/auth/oidc/start?returnTo=${encodeURIComponent(returnTo)}`} data-testid="sign-in-microsoft">
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
        <p className={s.caption}>Use your Microsoft work account. Only people invited by an administrator can sign in.</p>
      </div>
    </div>
  );
}
