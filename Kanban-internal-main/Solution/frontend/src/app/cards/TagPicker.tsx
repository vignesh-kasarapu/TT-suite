// Tag picker (D-062): toggle chips from the admin-managed vocabulary. No free text.
import { useTags } from '../org/api';
import { t } from '../../i18n/t';
import { cx } from '../../styles/cx';
import s from './cards.module.css';

export function TagPicker({
  value,
  onChange,
  disabled,
  testId = 'tag-picker',
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean | undefined;
  testId?: string;
}) {
  const tags = useTags();
  const items = tags.data?.items ?? [];
  if (tags.isSuccess && items.length === 0)
    return <span className={s.hint}>{t('tags.noneDefined')}</span>;
  return (
    <div className={s.chips} role="group" aria-label={t('card.tags')} data-testid={testId}>
      {items.map((tag) => {
        const on = value.includes(tag.name);
        return (
          <button
            key={tag.id}
            type="button"
            className={cx(s.chip, on && s.chipOn)}
            aria-pressed={on}
            disabled={disabled}
            onClick={() =>
              onChange(on ? value.filter((x) => x !== tag.name) : [...value, tag.name])
            }
            data-testid={`tag-${tag.name}`}
          >
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}
