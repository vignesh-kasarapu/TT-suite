// Comments tab (FR-040, FR-046 / D-068): one level of replies, thumbs up / down per person.
// Rules (who may reply, delete with replies, vote) are the server's; this only renders.
import { useState } from 'react';
import { Alert, Button, Skeleton } from '../../components';
import { t } from '../../i18n/t';
import { problemBanner, type Problem } from '../../api/client';
import { cx } from '../../styles/cx';
import { useContextData } from '../auth/useMe';
import { useCommentMutations, useComments, type Card, type Comment } from './api';
import { Markdown } from './Markdown';
import { MentionBox, useMentionable } from './MentionBox';
import s from './cards.module.css';

export function Comments({ card, canWrite }: { card: Card; canWrite: boolean }) {
  const me = useContextData();
  const comments = useComments(card.key);
  const { add, edit, remove, vote } = useCommentMutations(card.key);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // D-158: who "@" offers on this card.
  const people = useMentionable(card);

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

  const all = comments.data?.items ?? [];
  const top = all.filter((c) => c.parentId === null);
  const repliesOf = (id: string) => all.filter((c) => c.parentId === id);

  const votes = (cm: Comment) => (
    <span className={s.votes}>
      <button
        type="button"
        className={cx(s.vote, cm.myVote === 1 && s.voteOn)}
        aria-pressed={cm.myVote === 1}
        aria-label={t('comment.up')}
        title={t('comment.up')}
        onClick={() =>
          void run(() => vote.mutateAsync({ id: cm.id, value: cm.myVote === 1 ? 0 : 1 }))
        }
        data-testid="vote-up"
      >
        {'👍 '}
        {cm.up}
      </button>
      <button
        type="button"
        className={cx(s.vote, cm.myVote === -1 && s.voteOn)}
        aria-pressed={cm.myVote === -1}
        aria-label={t('comment.down')}
        title={t('comment.down')}
        onClick={() =>
          void run(() => vote.mutateAsync({ id: cm.id, value: cm.myVote === -1 ? 0 : -1 }))
        }
        data-testid="vote-down"
      >
        {'👎 '}
        {cm.down}
      </button>
    </span>
  );

  const body = (cm: Comment) =>
    editing?.id === cm.id ? (
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => edit.mutateAsync({ id: cm.id, body: editing.body })).then(
            (ok) => ok && setEditing(null),
          );
        }}
      >
        <MentionBox
          people={people}
          rows={3}
          value={editing.body}
          onChange={(v) => setEditing({ id: cm.id, body: v })}
          aria-label={t('card.editComment')}
          required
          data-testid="comment-edit-body"
        />
        <div className={s.actions}>
          <Button type="submit" variant="primary" busy={edit.isPending}>
            {t('card.save')}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(null)}>
            {t('card.cancel')}
          </Button>
        </div>
      </form>
    ) : (
      <>
        <Markdown text={cm.body} className={s.commentBody} />
        <div className={s.actions}>
          {votes(cm)}
          {canWrite && cm.parentId === null ? (
            <Button variant="ghost" onClick={() => setReplyTo(cm.id)} data-testid="comment-reply">
              {t('comment.reply')}
            </Button>
          ) : null}
          {cm.author.id === me.user.id ? (
            <>
              <Button
                variant="ghost"
                onClick={() => setEditing({ id: cm.id, body: cm.body })}
                data-testid="comment-edit"
              >
                {t('card.edit')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => void run(() => remove.mutateAsync(cm.id))}
                data-testid="comment-delete"
              >
                {t('card.delete')}
              </Button>
            </>
          ) : null}
        </div>
      </>
    );

  const head = (cm: Comment) => (
    <div className={s.commentHead}>
      <strong>{cm.author.name}</strong>
      <span className={s.hint}>
        {t('card.at', { when: new Date(cm.createdAt).toLocaleString() })}
        {cm.editedAt ? ` ${t('card.edited')}` : ''}
        {cm.copiedFromKey ? ` ${t('card.copiedFrom', { key: cm.copiedFromKey })}` : ''}
      </span>
    </div>
  );

  return (
    <div className={s.comments} data-testid="comments">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {comments.isPending ? (
        <Skeleton lines={3} label={t('card.loading')} />
      ) : (
        <ul className={s.commentList}>
          {top.map((cm) => (
            <li key={cm.id} className={s.comment} data-testid="comment">
              {head(cm)}
              {body(cm)}
              {repliesOf(cm.id).length ? (
                <ul className={s.replies}>
                  {repliesOf(cm.id).map((r) => (
                    <li key={r.id} className={s.comment} data-testid="reply">
                      {head(r)}
                      {body(r)}
                    </li>
                  ))}
                </ul>
              ) : null}
              {replyTo === cm.id ? (
                <form
                  className={s.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!reply.trim()) return;
                    void run(() => add.mutateAsync({ body: reply, parentId: cm.id })).then((ok) => {
                      if (ok) {
                        setReply('');
                        setReplyTo(null);
                      }
                    });
                  }}
                  data-testid="reply-form"
                >
                  <MentionBox
                    people={people}
                    rows={2}
                    maxLength={10000}
                    value={reply}
                    onChange={setReply}
                    aria-label={t('comment.replyTo', { name: cm.author.name })}
                    required
                    data-testid="reply-body"
                  />
                  <div className={s.actions}>
                    <Button type="submit" variant="primary" busy={add.isPending}>
                      {t('comment.reply')}
                    </Button>
                    <Button variant="ghost" onClick={() => setReplyTo(null)}>
                      {t('card.cancel')}
                    </Button>
                  </div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            void run(() => add.mutateAsync({ body: draft })).then((ok) => ok && setDraft(''));
          }}
          data-testid="comment-form"
        >
          <label className={s.field}>
            <span>{t('card.newComment')}</span>
            <MentionBox
              people={people}
              rows={3}
              maxLength={10000}
              placeholder={people.length ? t('comment.mentionHint') : undefined}
              value={draft}
              onChange={setDraft}
              required
              data-testid="comment-body"
            />
          </label>
          <div className={s.actions}>
            <Button
              type="submit"
              variant="primary"
              busy={add.isPending}
              busyLabel={t('card.saving')}
            >
              {t('card.addComment')}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
