// Pages for a long list (D-152 Backlog, D-153 Reports): "Showing 1–10 of N", page buttons with
// gaps as "…", and rows per page. Display only - the list is already the server's.
import { Icon } from '../../components/Icon';
import { t } from '../../i18n/t';
import { cx } from '../../styles/cx';
import s from './cards.module.css';

export const PAGE_SIZES = [10, 25, 50];

/** First, last, and two either side of the current page; the gaps become "…". */
function pageList(page: number, pages: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 2) out.push(p);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}

export function Pager({
  page,
  size,
  total,
  showing,
  onPage,
  onSize,
  idPrefix,
  pagePrefix = '',
}: {
  page: number;
  size: number;
  total: number;
  /** The "Showing {from}–{to} of {n} …" text. */
  showing: (from: number, to: number, n: number) => string;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
  /** Test ids: `${idPrefix}-showing`, `${idPrefix}-size`. */
  idPrefix: string;
  /** Test ids of the buttons: `${pagePrefix}page-N`, `-prev`, `-next`. */
  pagePrefix?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className={s.pager}>
      <span className={s.muted} data-testid={`${idPrefix}-showing`}>
        {showing(total === 0 ? 0 : (page - 1) * size + 1, Math.min(page * size, total), total)}
      </span>
      <nav className={s.pages} aria-label={t('backlog.pages')}>
        <button
          type="button"
          className={s.pageButton}
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
          aria-label={t('backlog.prev')}
          data-testid={`${pagePrefix}page-prev`}
        >
          <span className={s.flip}>
            <Icon name="chev" size={16} />
          </span>
        </button>
        {pageList(page, pages).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} className={s.pageGap}>
              {'…'}
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={cx(s.pageButton, p === page && s.pageOn)}
              aria-current={p === page ? 'page' : undefined}
              onClick={() => onPage(p)}
              data-testid={`${pagePrefix}page-${p}`}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className={s.pageButton}
          onClick={() => onPage(page + 1)}
          disabled={page === pages}
          aria-label={t('backlog.next')}
          data-testid={`${pagePrefix}page-next`}
        >
          <Icon name="chev" size={16} />
        </button>
      </nav>
      <label className={s.sizeLabel}>
        {t('backlog.rows')}
        <select
          className={s.input}
          value={size}
          onChange={(e) => onSize(Number(e.target.value))}
          data-testid={`${idPrefix}-size`}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
