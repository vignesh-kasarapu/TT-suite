// Shared frame for the S01 family: brand, title, one card, and the contact-admin form (D-125).
// No nav (FR-003).
import type { ReactNode } from 'react';
import s from './auth.module.css';
import { t } from '../../../i18n/t';
import { ContactAdmin } from './ContactAdmin';

export function AuthLayout({
  title,
  lead,
  children,
  testId,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <main className={s.page} id="main">
      <div className={s.card} data-testid={testId}>
        <span className={s.brand}>
          <img
            className={s.logo}
            src={`${import.meta.env.BASE_URL}brand/tektalis.png`}
            alt={t('brand.alt')}
            width={262}
            height={57}
          />
        </span>
        <div>
          <h1 className={s.title}>{title}</h1>
          {lead ? <p className={s.lead}>{lead}</p> : null}
        </div>
        {children}
        <ContactAdmin />
      </div>
    </main>
  );
}

export const authStyles = s;
