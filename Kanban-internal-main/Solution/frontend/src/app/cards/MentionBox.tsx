// @mentions in a comment (D-158): typing "@" and a few letters offers the people who may read
// the card; picking one writes `@[Name](user:<id>)` into the text, which shows as "@Name" and
// puts the comment under that person's inbox Mentions. Who may read a card is the server's rule
// (CR-14); this list only mirrors it as a convenience, and the inbox re-checks it.
import { useState, type TextareaHTMLAttributes } from 'react';
import { t } from '../../i18n/t';
import { cx } from '../../styles/cx';
import { useContextData } from '../auth/useMe';
import { useTeam, useUsers } from '../org/api';
import type { Card } from './api';
import s from './cards.module.css';

type Person = { id: string; name: string };
const SHOWN = 6;

/** People a mention may name on this card: none on a private card; the team's members and the
 *  admins on a team card; anyone on a team-less one. Never the writer. */
export function useMentionable(card: Card): Person[] {
  const me = useContextData();
  const team = useTeam(card.plane === 'org' && card.teamId ? card.teamId : '');
  const users = useUsers();
  if (card.plane !== 'org') return [];
  const everyone = users.data?.items ?? [];
  const list: Person[] = card.teamId
    ? [
        ...(team.data?.members ?? []).filter((m) => m.status !== 'invited'),
        ...everyone.filter((u) => u.role === 'admin'),
      ]
    : everyone;
  const seen = new Set<string>([me.user.id]);
  return list
    .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function MentionBox({
  value,
  onChange,
  people,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  people: Person[];
}) {
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const matches = query
    ? people.filter((p) => p.name.toLowerCase().includes(query.text.toLowerCase())).slice(0, SHOWN)
    : [];

  /** The "@word" just before the caret, if the caret is in one. */
  function look(text: string, caret: number) {
    const m = /(^|\s)@([^\s@[\]()]{0,30})$/.exec(text.slice(0, caret));
    if (!m || people.length === 0) return setQuery(null);
    setQuery({ text: m[2] ?? '', start: caret - (m[2] ?? '').length - 1 });
    setActive(0);
  }
  function pick(p: Person, el: HTMLTextAreaElement) {
    if (!query) return;
    const token = `@[${p.name}](user:${p.id}) `;
    const end = query.start + 1 + query.text.length;
    const next = value.slice(0, query.start) + token + value.slice(end);
    onChange(next);
    setQuery(null);
    const caret = query.start + token.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }
  const listId = `${rest.id ?? rest['aria-label'] ?? 'comment'}-mentions`.replace(/\s+/g, '-');
  return (
    <span className={s.mentionWrap}>
      <textarea
        {...rest}
        className={cx(s.input, s.textarea, rest.className)}
        value={value}
        aria-autocomplete="list"
        aria-controls={matches.length ? listId : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          look(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (!matches.length) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = matches.length;
            setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            const p = matches[active];
            if (p) pick(p, e.currentTarget);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setQuery(null);
          }
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
      />
      {matches.length ? (
        <ul
          className={s.mentionList}
          id={listId}
          role="listbox"
          aria-label={t('comment.mentionList')}
          data-testid="mention-list"
        >
          {matches.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={cx(s.mentionOption, i === active && s.mentionOn)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const el = e.currentTarget
                    .closest(`.${s.mentionWrap ?? ''}`)
                    ?.querySelector('textarea');
                  if (el) pick(p, el);
                }}
                data-testid={`mention-${p.id}`}
              >
                {`@${p.name}`}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
