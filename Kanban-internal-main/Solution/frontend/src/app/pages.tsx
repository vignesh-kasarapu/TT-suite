// Pages: Not found, Permission denied, App error, and the placeholder for screens
// that arrive later.
import { useLocation, useRouteError } from 'react-router';
import { EmptyState, ErrorState, LinkButton, Button } from '../components';
import { t } from '../i18n/t';
import { useContextData } from './auth/useMe';

export function Placeholder() {
  return <EmptyState title={t('placeholder.title')} body={t('placeholder.body')} />;
}

export function NotFound() {
  const { pathname } = useLocation();
  return (
    <div data-testid="not-found">
      <EmptyState
        heading="h1"
        title={t('notFound.title')}
        body={t('notFound.body', { path: pathname })}
        action={<LinkButton to="/">{t('notFound.action')}</LinkButton>}
      />
    </div>
  );
}

export function PermissionDenied() {
  return (
    <div data-testid="permission-denied">
      <ErrorState
        heading="h1"
        title={t('denied.title')}
        body={t('denied.body')}
        action={<LinkButton to="/">{t('denied.action')}</LinkButton>}
      />
    </div>
  );
}

/** Renders the page only when the server-reported role allows it; otherwise the denied page. */
/** `admin` = admins only; `manage` = admins and team leads (CR-11), who see a reduced page. */
export function RequireRole({
  need,
  children,
}: {
  need: 'admin' | 'manage';
  children: React.ReactNode;
}) {
  const me = useContextData();
  const allowed = me.user.role === 'admin' || (need === 'manage' && me.leadTeamIds.length > 0);
  return allowed ? <>{children}</> : <PermissionDenied />;
}

export function AppError() {
  useRouteError(); // consumed so the router does not re-throw; details are never shown (no stack in the UI)
  return (
    <div data-testid="app-error">
      <ErrorState
        heading="h1"
        title={t('error.title')}
        body={t('error.body')}
        action={<Button onClick={() => window.location.reload()}>{t('error.action')}</Button>}
      />
    </div>
  );
}
