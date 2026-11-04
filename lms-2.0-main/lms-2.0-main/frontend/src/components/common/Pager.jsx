import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GhostButton } from './GlassButton';

/** The six-rows-a-page footer the admin lists share.
 *
 *  Long admin lists (the employee roster, the audit log) are read a screenful at a time, so
 *  they page rather than scroll on forever. The whole list is already in the browser; this
 *  only decides what is shown — when a roster grows into the thousands the endpoints
 *  themselves need paging too.
 */
export const PAGE_SIZE = 6;

/** The slice for `page`, and a page number that stays inside the list as it is filtered. */
export function pageOf(rows, page, size = PAGE_SIZE) {
  const totalPages = Math.max(Math.ceil(rows.length / size), 1);
  const current = Math.min(Math.max(page, 1), totalPages);
  const start = (current - 1) * size;
  return { visible: rows.slice(start, start + size), start, current, totalPages };
}

export default function Pager({ page, totalPages, start, size = PAGE_SIZE, total, onPage, label = 'rows' }) {
  if (total <= size) return null;
  return (
    <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-border small muted">
      <span>
        Showing {start + 1}-{Math.min(start + size, total)} of {total} {label}
      </span>
      <div className="flex items-center gap-2">
        <GhostButton
          type="button"
          className="btn--sm !px-2"
          onClick={() => onPage(Math.max(page - 1, 1))}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </GhostButton>
        <span>Page {page} of {totalPages}</span>
        <GhostButton
          type="button"
          className="btn--sm !px-2"
          onClick={() => onPage(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </GhostButton>
      </div>
    </div>
  );
}
