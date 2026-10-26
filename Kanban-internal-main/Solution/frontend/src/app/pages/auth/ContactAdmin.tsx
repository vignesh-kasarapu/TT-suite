// D-125: someone who cannot sign in writes to the admins (name, work email, message). The server
// mails every active admin; it answers the same whoever asks, so the form only says "sent".
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { authStyles as s } from './AuthLayout';
import b from '../../../components/components.module.css';
import { cx } from '../../../styles/cx';
import { Alert, Button, Field } from '../../../components';
import { api, ensureOk, fieldErrorsOf, problemMessage, type Problem } from '../../../api/client';
import { t } from '../../../i18n/t';

const EMPTY = { name: '', email: '', message: '' };

export function ContactAdmin() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<Problem | null>(null);
  const send = useMutation({
    mutationFn: async () => {
      ensureOk(await api.POST('/auth/contact-admin', { body: form }));
    },
    onSuccess: () => {
      setSent(true);
      setForm(EMPTY);
    },
    onError: (problem: Problem) => setError(problem),
  });
  const fields = fieldErrorsOf(error ?? undefined);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    send.mutate();
  }

  if (sent)
    return (
      <div data-testid="contact-sent">
        <Alert tone="success">{t('contact.sent')}</Alert>
      </div>
    );

  if (!open)
    return (
      <p className={s.support}>
        <button
          type="button"
          className={s.supportLink}
          onClick={() => setOpen(true)}
          data-testid="contact-open"
        >
          {t('auth.support')}
        </button>
      </p>
    );

  return (
    <form className={s.contact} onSubmit={onSubmit} data-testid="contact-form">
      <h2 className={s.contactTitle}>{t('contact.title')}</h2>
      {error && !Object.keys(fields).length ? (
        <div data-testid="contact-error">
          <Alert tone="danger">{problemMessage(error)}</Alert>
        </div>
      ) : null}
      <Field
        id="contact-name"
        label={t('contact.name')}
        value={form.name}
        maxLength={120}
        autoComplete="name"
        required
        error={fields['name']}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        data-testid="contact-name"
      />
      <Field
        id="contact-email"
        type="email"
        label={t('contact.email')}
        value={form.email}
        maxLength={254}
        autoComplete="email"
        required
        error={fields['email']}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        data-testid="contact-email"
      />
      <div className={b.field}>
        <label htmlFor="contact-message" className={b.fieldLabel}>
          {t('contact.message')}
        </label>
        <textarea
          id="contact-message"
          className={cx(b.input, s.contactMessage)}
          rows={4}
          maxLength={2000}
          required
          placeholder={t('contact.placeholder')}
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          data-testid="contact-message"
        />
      </div>
      <div className={s.actions}>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t('contact.cancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          busy={send.isPending}
          busyLabel={t('contact.sending')}
          data-testid="contact-send"
        >
          {t('contact.send')}
        </Button>
      </div>
    </form>
  );
}
