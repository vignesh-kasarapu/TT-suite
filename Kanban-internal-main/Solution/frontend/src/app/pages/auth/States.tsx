// Terminal states: access refused, signed out, session expired.
import { useNavigate } from 'react-router';
import { AuthLayout, authStyles as s } from './AuthLayout';
import { Button, LinkButton } from '../../../components';
import { t } from '../../../i18n/t';
import { peekReturnTo } from '../../auth/session';

export function Refused() {
  return (
    <AuthLayout title={t('refused.title')} lead={t('refused.lead')} testId="access-refused">
      <p data-testid="admin-contact">{t('refused.contact')}</p>
      <div className={s.actions}>
        <LinkButton to="/sign-in">{t('auth.backToSignIn')}</LinkButton>
      </div>
    </AuthLayout>
  );
}

export function SignedOut() {
  return (
    <AuthLayout title={t('signedOut.title')} lead={t('signedOut.lead')} testId="signed-out">
      <div className={s.actions}>
        <LinkButton to="/sign-in">{t('signedOut.again')}</LinkButton>
      </div>
    </AuthLayout>
  );
}

export function Expired() {
  const navigate = useNavigate();
  const returnTo = peekReturnTo();
  return (
    <AuthLayout title={t('expired.title')} lead={t('expired.lead')} testId="session-expired">
      {returnTo ? <p>{t('expired.returnHint')}</p> : null}
      <div className={s.actions}>
        <Button variant="primary" onClick={() => void navigate('/sign-in')}>
          {t('auth.signIn')}
        </Button>
      </div>
    </AuthLayout>
  );
}
