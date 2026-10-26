// Time tab (FR-043 / D-071): entries with the total; log needs write access; edit/delete own.
import { useState } from 'react';
import { Alert, Button, Skeleton } from '../../components';
import { t } from '../../i18n/t';
import { fieldErrorsOf, problemBanner, type Problem } from '../../api/client';
import { cx } from '../../styles/cx';
import { useContextData } from '../auth/useMe';
import { useTimeEntries, useTimeMutations, type Card, type TimeEntry } from './api';
import { canLogTime } from '../time/api';
import s from './cards.module.css';

function Form({
  initial,
  onSubmit,
  onCancel,
  busy,
  errors,
  testId,
}: {
  initial: { date: string; hours: string; note: string };
  onSubmit: (b: { date: string; hours: number; note: string }) => Promise<boolean>;
  onCancel?: (() => void) | undefined;
  busy: boolean;
  errors: Record<string, string>;
  testId: string;
}) {
  const [f, setF] = useState(initial);
  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.date || !f.hours) return;
        void onSubmit({ date: f.date, hours: Number(f.hours), note: f.note }).then(
          (ok) => ok && !onCancel && setF({ ...initial, note: '' }),
        );
      }}
      data-testid={testId}
    >
      <div className={s.row}>
        <label className={s.field}>
          <span>{t('time.date')}</span>
          <input
            className={s.input}
            type="date"
            required
            value={f.date}
            onChange={(e) => setF({ ...f, date: e.target.value })}
            data-testid={`${testId}-date`}
          />
        </label>
        <label className={s.field}>
          <span>{t('time.hours')}</span>
          <input
            className={cx(s.input, errors['hours'] && s.invalid)}
            type="number"
            min={0.25}
            max={24}
            step={0.25}
            required
            inputMode="decimal"
            value={f.hours}
            onChange={(e) => setF({ ...f, hours: e.target.value })}
            data-testid={`${testId}-hours`}
          />
        </label>
        <label className={s.field}>
          <span>{t('time.note')}</span>
          <input
            className={s.input}
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            data-testid={`${testId}-note`}
          />
        </label>
      </div>
      <div className={s.actions}>
        <Button type="submit" variant="primary" busy={busy} data-testid={`${testId}-submit`}>
          {onCancel ? t('card.save') : t('time.log')}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            {t('card.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function Time({ card, canWrite }: { card: Card; canWrite: boolean }) {
  const me = useContextData();
  const list = useTimeEntries(card.key);
  const { add, edit, remove } = useTimeMutations(card.key);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
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
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className={s.comments} data-testid="time">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {/* Logging comes first - it is what people open the tab for; the list follows. */}
      {canWrite && canLogTime(card, me) ? (
        <Form
          initial={{ date: today, hours: '', note: '' }}
          onSubmit={(b) => run(() => add.mutateAsync(b))}
          busy={add.isPending}
          errors={errors}
          testId="time-add"
        />
      ) : null}
      <p className={s.hint} data-testid="time-total">
        {t(list.data?.scope === 'own' ? 'time.totalOwn' : 'time.total', {
          logged: String(list.data?.total ?? 0),
          effort: card.effortHours === null ? t('card.none') : String(card.effortHours),
        })}
      </p>
      {list.isPending ? (
        <Skeleton lines={3} label={t('card.loading')} />
      ) : (
        <ul className={s.commentList}>
          {(list.data?.items ?? []).length === 0 ? (
            <li className={s.hint}>{t('time.none')}</li>
          ) : null}
          {(list.data?.items ?? []).map((e) =>
            editing?.id === e.id ? (
              <li key={e.id} className={s.comment}>
                <Form
                  initial={{ date: e.date, hours: String(e.hours), note: e.note }}
                  onSubmit={(b) =>
                    run(() => edit.mutateAsync({ id: e.id, body: b })).then(
                      (ok) => (ok && setEditing(null), ok),
                    )
                  }
                  onCancel={() => setEditing(null)}
                  busy={edit.isPending}
                  errors={errors}
                  testId="time-edit"
                />
              </li>
            ) : (
              <li key={e.id} className={s.comment} data-testid="time-entry">
                <div className={s.commentHead}>
                  <span>
                    <strong>{t('time.hoursShort', { n: String(e.hours) })}</strong>{' '}
                    {`${e.date} · ${e.user.name}`}
                  </span>
                  {e.user.id === me.user.id && card.closedAt === null ? ( // CR-24
                    <span className={s.actions}>
                      <Button
                        variant="ghost"
                        onClick={() => setEditing(e)}
                        data-testid="time-edit-btn"
                      >
                        {t('card.edit')}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void run(() => remove.mutateAsync(e.id))}
                        data-testid="time-delete"
                      >
                        {t('card.delete')}
                      </Button>
                    </span>
                  ) : null}
                </div>
                {e.note ? <p className={s.hint}>{e.note}</p> : null}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/** ETA / effort history (FR-042): filtered views of the card's events. */
export function FieldHistory({ card, field }: { card: Card; field: 'eta' | 'effort' }) {
  return <HistoryList cardKey={card.key} field={field} />;
}
import { useCardEvents } from './api';
import { show } from './CardDetail';
function HistoryList({ cardKey, field }: { cardKey: string; field: 'eta' | 'effort' }) {
  const events = useCardEvents(cardKey, field);
  const items = events.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <details className={s.historyBox} data-testid={`history-${field}`}>
      <summary>
        {t(field === 'eta' ? 'card.etaHistory' : 'card.effortHistory', { n: String(items.length) })}
      </summary>
      <ul className={s.eventList}>
        {items.map((ev) => (
          <li key={ev.id} className={s.hint}>
            {`${new Date(ev.createdAt).toLocaleDateString()} ${ev.actor.name}: ${show(ev.oldValue)} → `}
            {show(ev.newValue)}
          </li>
        ))}
      </ul>
    </details>
  );
}
