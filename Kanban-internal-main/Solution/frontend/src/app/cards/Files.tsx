// Files tab (FR-047 / D-069): link attachments on a card - title + URL, optional kind/note.
// Also renders the same list for project common links (FR-048) via `AttachmentList`.
import { useState } from 'react';
import { Alert, Button, Pill, Skeleton } from '../../components';
import { t } from '../../i18n/t';
import { fieldErrorsOf, problemBanner, type Problem } from '../../api/client';
import { cx } from '../../styles/cx';
import type { Attachment, AttachmentCreate } from './api';
import { useAttachmentMutations, useCardAttachments, type Card } from './api';
import s from './cards.module.css';

const KINDS = ['document', 'design', 'spec', 'other'] as const;

export function AttachmentList({
  items,
  onRemove,
}: {
  items: Attachment[];
  onRemove?: ((id: string) => void) | undefined;
}) {
  if (items.length === 0) return <p className={s.hint}>{t('files.none')}</p>;
  return (
    <ul className={s.commentList}>
      {items.map((a) => (
        <li key={a.id} className={s.comment} data-testid="attachment">
          <div className={s.commentHead}>
            <a href={a.url} target="_blank" rel="noopener noreferrer" className={s.fileLink}>
              {a.title}
            </a>
            <span className={s.meta}>
              {a.kind ? (
                <Pill tone="muted">{t(`files.kind.${a.kind}` as 'files.kind.other')}</Pill>
              ) : null}
              <span className={s.hint}>{a.addedBy.name}</span>
              {onRemove ? (
                <Button
                  variant="ghost"
                  onClick={() => onRemove(a.id)}
                  data-testid="attachment-remove"
                >
                  {t('link.remove')}
                </Button>
              ) : null}
            </span>
          </div>
          {a.note ? <p className={s.hint}>{a.note}</p> : null}
          <span className={cx(s.hint, s.truncate)}>{a.url}</span>
        </li>
      ))}
    </ul>
  );
}

export function AttachmentForm({
  onSubmit,
  busy,
  errors,
  testId = 'attachment-form',
}: {
  onSubmit: (body: AttachmentCreate) => Promise<boolean>;
  busy: boolean;
  errors: Record<string, string>;
  testId?: string;
}) {
  const [form, setForm] = useState({ title: '', url: '', kind: '', note: '' });
  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (!form.title.trim() || !form.url.trim()) return;
        const kind = form.kind ? (form.kind as NonNullable<AttachmentCreate['kind']>) : null;
        void onSubmit({
          title: form.title.trim(),
          url: form.url.trim(),
          kind,
          note: form.note,
        }).then((ok) => ok && setForm({ title: '', url: '', kind: '', note: '' }));
      }}
      data-testid={testId}
    >
      <div className={s.row}>
        <label className={s.field}>
          <span>{t('files.title')}</span>
          <input
            className={cx(s.input, errors['title'] && s.invalid)}
            value={form.title}
            maxLength={200}
            required
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            data-testid="attachment-title"
          />
        </label>
        <label className={s.field}>
          <span>{t('files.url')}</span>
          <input
            className={cx(s.input, errors['url'] && s.invalid)}
            type="url"
            value={form.url}
            maxLength={2048}
            required
            placeholder="https://"
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            data-testid="attachment-url"
          />
          {errors['url'] ? <span className={s.fieldError}>{errors['url']}</span> : null}
        </label>
        <label className={s.field}>
          <span>{t('files.kind')}</span>
          <select
            className={s.input}
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
            data-testid="attachment-kind"
          >
            <option value="">{t('card.none')}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`files.kind.${k}` as 'files.kind.other')}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={s.field}>
        <span>{t('files.note')}</span>
        <input
          className={s.input}
          value={form.note}
          maxLength={1000}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </label>
      <span className={s.hint}>{t('files.hint')}</span>
      <div className={s.actions}>
        <Button type="submit" variant="primary" busy={busy} data-testid="attachment-add">
          {t('files.add')}
        </Button>
      </div>
    </form>
  );
}

export function Files({ card, canWrite }: { card: Card; canWrite: boolean }) {
  const list = useCardAttachments(card.key);
  const { add, remove } = useAttachmentMutations(card.key);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setErrors({});
    try {
      await fn();
      return true;
    } catch (p) {
      setError(problemBanner(p as Problem));
      setErrors(fieldErrorsOf(p as Problem));
      return false;
    }
  }
  return (
    <div className={s.comments} data-testid="files">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {list.isPending ? (
        <Skeleton lines={3} label={t('card.loading')} />
      ) : (
        <AttachmentList
          items={list.data?.items ?? []}
          onRemove={canWrite ? (id) => void run(() => remove.mutateAsync(id)) : undefined}
        />
      )}
      {canWrite ? (
        <AttachmentForm
          onSubmit={(b) => run(() => add.mutateAsync(b))}
          busy={add.isPending}
          errors={errors}
        />
      ) : null}
    </div>
  );
}
