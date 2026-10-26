// Links tab (FR-030..032): both directions, `blocks` shown active/cleared as the server says.
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Pill, Skeleton } from '../../components';
import { t } from '../../i18n/t';
import { problemBanner, type Problem } from '../../api/client';
import {
  LINK_TYPES,
  useCardLinks,
  useLinkMutations,
  type Card,
  type CardLink,
  type LinkType,
} from './api';
import s from './cards.module.css';

/** Human phrase for a link as seen from this card. */
export function linkPhrase(l: CardLink): string {
  if (l.type === 'relates_to') return t('link.relates_to');
  if (l.type === 'depends_on') return t(l.direction === 'out' ? 'link.dependsOn' : 'link.neededBy');
  return t(l.direction === 'out' ? 'link.blocks' : 'link.blockedBy');
}

export function Links({ card, canWrite }: { card: Card; canWrite: boolean }) {
  const links = useCardLinks(card.key);
  const { add, remove } = useLinkMutations(card.key);
  const [type, setType] = useState<LinkType>('relates_to');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      return true;
    } catch (p) {
      setError(problemBanner(p as Problem));
      return false;
    }
  }

  return (
    <div className={s.comments} data-testid="links">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {links.isPending ? (
        <Skeleton lines={3} label={t('card.loading')} />
      ) : (
        <ul className={s.commentList}>
          {(links.data?.items ?? []).length === 0 ? (
            <li className={s.hint}>{t('link.none')}</li>
          ) : null}
          {(links.data?.items ?? []).map((l) => (
            <li key={l.id} className={s.comment} data-testid="link">
              <div className={s.commentHead}>
                <span>
                  <span className={s.hint}>{linkPhrase(l)}</span>{' '}
                  <Link to={`/cards/${l.card.key}`} className={s.key}>
                    {l.card.key}
                  </Link>{' '}
                  {l.card.title}
                </span>
                <span className={s.meta}>
                  {l.type === 'blocks' ? (
                    <Pill tone={l.active ? 'danger' : 'success'}>
                      {t(l.active ? 'link.active' : 'link.cleared')}
                    </Pill>
                  ) : null}
                  <Pill tone="muted">{t(`state.${l.card.state}` as 'state.backlog')}</Pill>
                  {canWrite ? (
                    <Button
                      variant="ghost"
                      onClick={() => void run(() => remove.mutateAsync(l.id))}
                      data-testid="link-remove"
                    >
                      {t('link.remove')}
                    </Button>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            const targetKey = target.trim().toUpperCase();
            if (!targetKey) return;
            void run(() => add.mutateAsync({ type, targetKey })).then((ok) => ok && setTarget(''));
          }}
          data-testid="link-form"
        >
          <div className={s.row}>
            <label className={s.field}>
              <span>{t('link.type')}</span>
              <select
                className={s.input}
                value={type}
                onChange={(e) => setType(e.target.value as LinkType)}
                data-testid="link-type"
              >
                {LINK_TYPES.map((lt) => (
                  <option key={lt} value={lt}>
                    {t(`link.type.${lt}` as 'link.type.blocks')}
                  </option>
                ))}
              </select>
            </label>
            <label className={s.field}>
              <span>{t('link.target')}</span>
              <input
                className={s.input}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="K-12"
                pattern="^[Kk]-[0-9]{1,9}$"
                required
                data-testid="link-target"
              />
            </label>
          </div>
          <span className={s.hint}>{t(`link.hint.${type}` as 'link.hint.blocks')}</span>
          <div className={s.actions}>
            <Button
              type="submit"
              variant="primary"
              busy={add.isPending}
              busyLabel={t('card.saving')}
            >
              {t('link.add')}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
