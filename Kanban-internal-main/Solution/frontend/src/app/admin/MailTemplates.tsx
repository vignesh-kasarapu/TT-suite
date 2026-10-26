// Administration > Email templates (D-141): admins edit each email's subject and text with
// {placeholders}; the server keeps the Outlook layout, checks placeholders and renders previews.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Alert, Button, ConfirmDialog, Pill, Skeleton } from '../../components';
import {
  api,
  ensureOk,
  fieldErrorsOf,
  problemBanner,
  unwrap,
  type Problem,
} from '../../api/client';
import type { components } from '../../api/schema';
import { t } from '../../i18n/t';
import c from '../cards/cards.module.css';
import o from '../org/org.module.css';
import s from './mail.module.css';

type Template = components['schemas']['MailTemplate'];
type Kind = Template['kind'];
type Preview = components['schemas']['MailPreview'];
const KEY = ['mail-templates'];

function useTemplates() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => unwrap(await api.GET('/admin/mail-templates')),
  });
}

export function AdminMailTemplates() {
  const list = useTemplates();
  const items = list.data?.items ?? [];
  const [kind, setKind] = useState<Kind | ''>('');
  const current = items.find((i) => i.kind === kind) ?? items[0];
  if (list.isPending) return <Skeleton lines={6} label={t('skeleton.label')} />;
  if (!current) return null;
  return (
    <section className={o.section} data-testid="admin-mail-templates">
      <p className={c.hint}>{t('mail.lead')}</p>
      <label className={c.field}>
        <span>{t('mail.email')}</span>
        <select
          className={c.input}
          value={current.kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          data-testid="mail-kind"
        >
          {items.map((i) => (
            <option key={i.kind} value={i.kind}>
              {i.edited ? `${i.label} ${t('mail.editedMark')}` : i.label}
            </option>
          ))}
        </select>
      </label>
      {/* Re-mounted per email so the form starts from that email's text (keyed on the kind
          only: a save must not reset the form and its "Saved" message). */}
      <Editor key={current.kind} template={current} />
    </section>
  );
}

function Editor({ template }: { template: Template }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ subject: template.subject, body: template.body });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const path = { params: { path: { kind: template.kind } } };
  const fail = (p: Problem) => {
    setProblem(p);
    setSaved(false);
  };
  const save = useMutation({
    mutationFn: async () =>
      unwrap(await api.PUT('/admin/mail-templates/{kind}', { ...path, body: form })),
    onSuccess: (data) => {
      queryClient.setQueryData(KEY, data);
      setProblem(null);
      setSaved(true);
    },
    onError: fail,
  });
  const reset = useMutation({
    mutationFn: async () => {
      const res = await api.DELETE('/admin/mail-templates/{kind}', path);
      ensureOk(res);
      return unwrap(res);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(KEY, data);
      setResetting(false);
      setSaved(false);
      setPreview(null);
      // Back to the built-in wording in the form as well.
      setForm({ subject: template.defaultSubject, body: template.defaultBody });
    },
    onError: fail,
  });
  const show = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/admin/mail-templates/{kind}/preview', { ...path, body: form })),
    onSuccess: (data) => {
      setPreview(data);
      setProblem(null);
    },
    onError: fail,
  });
  const fields = fieldErrorsOf(problem ?? undefined);

  /** A placeholder goes in at the cursor of the text box. */
  function insert(name: string) {
    const el = bodyRef.current;
    const token = `{${name}}`;
    const at = el?.selectionStart ?? form.body.length;
    const end = el?.selectionEnd ?? at;
    setForm({ ...form, body: form.body.slice(0, at) + token + form.body.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  }

  return (
    <form
      className={s.editor}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setSaved(false);
        save.mutate();
      }}
      data-testid="mail-form"
    >
      <div className={s.status}>
        {template.edited ? (
          <Pill tone="accent">{t('mail.edited')}</Pill>
        ) : (
          <Pill tone="muted">{t('mail.default')}</Pill>
        )}
      </div>
      <label className={c.field}>
        <span>{t('mail.subject')}</span>
        <input
          className={c.input}
          value={form.subject}
          maxLength={300}
          required
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
          data-testid="mail-subject"
        />
      </label>
      <label className={c.field}>
        <span>{t('mail.body')}</span>
        <textarea
          ref={bodyRef}
          className={`${c.input} ${s.body}`}
          rows={10}
          maxLength={10000}
          required
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          data-testid="mail-body"
        />
        {fields['body'] ? <span className={c.fieldError}>{fields['body']}</span> : null}
      </label>
      <div className={s.placeholders}>
        <span className={c.hint}>{t('mail.placeholders')}</span>
        {template.placeholders.map((name) => (
          <button
            key={name}
            type="button"
            className={s.chip}
            onClick={() => insert(name)}
            data-testid={`mail-placeholder-${name}`}
          >
            {`{${name}}`}
          </button>
        ))}
      </div>
      {problem && !fields['body'] ? <Alert tone="danger">{problemBanner(problem)}</Alert> : null}
      {saved ? (
        <div data-testid="mail-saved">
          <Alert tone="success">{t('mail.saved')}</Alert>
        </div>
      ) : null}
      <div className={c.actions}>
        <Button
          type="submit"
          variant="primary"
          busy={save.isPending}
          busyLabel={t('card.saving')}
          data-testid="mail-save"
        >
          {t('card.save')}
        </Button>
        <Button onClick={() => show.mutate()} busy={show.isPending} data-testid="mail-preview">
          {t('mail.preview')}
        </Button>
        {template.edited ? (
          <Button variant="ghost" onClick={() => setResetting(true)} data-testid="mail-reset">
            {t('mail.reset')}
          </Button>
        ) : null}
      </div>
      {preview ? (
        <div className={s.preview} data-testid="mail-preview-panel">
          <p className={c.hint}>{t('mail.previewNote')}</p>
          <p className={s.previewSubject} data-testid="mail-preview-subject">
            {preview.subject}
          </p>
          {/* The text as sent; the Outlook layout (inline styles) cannot be drawn here under the
              app's CSP, which forbids inline styles - the emails themselves carry it. */}
          <div className={s.previewText} data-testid="mail-preview-text">
            {preview.text}
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={resetting}
        title={t('mail.resetTitle')}
        confirmLabel={t('mail.reset')}
        cancelLabel={t('card.cancel')}
        onConfirm={() => reset.mutate()}
        onCancel={() => setResetting(false)}
        busy={reset.isPending}
        testId="mail-reset-dialog"
      >
        {t('mail.resetBody', { email: template.label })}
      </ConfirmDialog>
    </form>
  );
}
